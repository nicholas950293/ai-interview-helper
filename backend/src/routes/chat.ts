import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AppError } from '../lib/errors.js';
import { chatRequestSchema, chatSystemRequestSchema } from '../lib/schemas.js';
import { currentSessionId, requireSession } from '../lib/auth.js';
import {
  findAnswer,
  findSessionById,
  insertChatMessage,
  isQuestionInSession,
  listChatMessages,
  listSessionQuestions,
  updateChatMessageContent,
} from '../db/queries.js';
import { assertWritable, isTerminal } from '../domain/session-state.js';
import { streamCompletion, type ChatTurn } from '../ai/gemini.js';
import { applyGuardrail, inspectResponse } from '../ai/postprocess.js';
import type { PromptContext } from '../ai/guardrails.js';

export const chatRoutes = new Hono();

/** 待取用的串流；`POST /api/chat` 建立，`GET /api/chat/stream/:id` 消費一次後移除。 */
interface PendingStream {
  sessionId: string;
  messageId: string;
  context: PromptContext;
  history: ChatTurn[];
  prompt: string;
  createdAt: number;
}

const pendingStreams = new Map<string, PendingStream>();
const STREAM_TTL_MS = 60_000;

function reapExpiredStreams(): void {
  const cutoff = Date.now() - STREAM_TTL_MS;
  for (const [id, stream] of pendingStreams) {
    if (stream.createdAt < cutoff) pendingStreams.delete(id);
  }
}

/** 對話歷程只取同一題的部分——切題後 AI MUST NOT 參照前一題內容（US3 情境 4）。 */
function historyForQuestion(sessionId: string, questionId: string): ChatTurn[] {
  return listChatMessages(sessionId)
    .filter((m) => m.questionId === questionId && m.role !== 'system')
    .map((m) => ({ role: m.role as 'candidate' | 'assistant', content: m.content }));
}

// POST /api/chat —— 送出提問，回傳串流 id
chatRoutes.post('/chat', requireSession, async (c) => {
  const sessionId = currentSessionId(c);
  const session = findSessionById(sessionId);
  if (!session) throw new AppError('UNAUTHORIZED');
  assertWritable(session.status);

  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError('BAD_REQUEST');

  const { questionId, content, attachCode, source } = parsed.data;
  if (!isQuestionInSession(sessionId, questionId)) throw new AppError('NOT_FOUND');

  const question = listSessionQuestions(sessionId).find((q) => q.id === questionId);
  if (!question) throw new AppError('NOT_FOUND');

  const answer = findAnswer(sessionId, questionId);
  // attachCode 時取該題最後保存的草稿；前端 MUST 先 flush（ui-contracts A-03）。
  const attachedCode = attachCode ? (answer?.content ?? '') : null;

  const history = historyForQuestion(sessionId, questionId);

  // 應試者的提問先落地——對話 MUST 完整留存（FR-015）
  insertChatMessage({
    sessionId,
    questionId,
    role: 'candidate',
    content,
    attachedCode,
    source,
  });

  // AI 回覆先建立空訊息，串流過程逐步補上內容
  const assistantMessage = insertChatMessage({
    sessionId,
    questionId,
    role: 'assistant',
    content: '',
    guidanceMode: session.guidance_mode,
  });

  const streamId = randomUUID();
  reapExpiredStreams();
  pendingStreams.set(streamId, {
    sessionId,
    messageId: assistantMessage.id,
    context: {
      mode: session.guidance_mode,
      question: {
        title: question.title,
        description: question.description,
        complexityRequirement: question.complexityRequirement,
        gradingFocus: question.gradingFocus,
      },
      attachedCode,
      language: answer?.language ?? 'javascript',
    },
    history,
    prompt: content,
    createdAt: Date.now(),
  });

  return c.json({ streamId, messageId: assistantMessage.id }, 202);
});

// GET /api/chat/stream/:streamId —— SSE 串流 AI 回覆
chatRoutes.get('/chat/stream/:streamId', requireSession, (c) => {
  const sessionId = currentSessionId(c);
  const streamId = c.req.param('streamId');
  const pending = pendingStreams.get(streamId);

  if (!pending || pending.sessionId !== sessionId) {
    throw new AppError('NOT_FOUND');
  }
  pendingStreams.delete(streamId);

  return streamSSE(c, async (stream) => {
    let buffer = '';
    let triggered = false;

    try {
      for await (const token of streamCompletion(pending)) {
        // 場次進入終態時立即中止（Edge Case：時間歸零當下 AI 正在回覆）
        const current = findSessionById(sessionId);
        if (!current || isTerminal(current.status)) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              code: 'SESSION_SUBMITTED',
              message: '場次已結束，AI 回覆已中止。',
            }),
          });
          updateChatMessageContent(pending.messageId, buffer, false);
          return;
        }

        buffer += token;

        // 圍欄命中即停止串流：MUST NOT 先送出違規內容再撤回。
        if (inspectResponse(buffer).blocked) {
          triggered = true;
          break;
        }

        await stream.writeSSE({ event: 'token', data: JSON.stringify({ text: token }) });
      }

      if (triggered) {
        const guarded = applyGuardrail(buffer);
        updateChatMessageContent(pending.messageId, guarded.content, true);
        // 已送出的片段請前端整段丟棄，改用圍欄訊息重繪。
        await stream.writeSSE({
          event: 'replace',
          data: JSON.stringify({ text: guarded.content }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ messageId: pending.messageId, guardrailTriggered: true }),
        });
        return;
      }

      const guarded = applyGuardrail(buffer);
      updateChatMessageContent(pending.messageId, guarded.content, guarded.triggered);
      if (guarded.triggered) {
        await stream.writeSSE({
          event: 'replace',
          data: JSON.stringify({ text: guarded.content }),
        });
      }
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          messageId: pending.messageId,
          guardrailTriggered: guarded.triggered,
        }),
      });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_UNAVAILABLE';
      const message =
        err instanceof AppError
          ? err.message
          : 'AI 助教目前無法回應，你的作答內容不受影響，稍後可再試一次。';

      updateChatMessageContent(pending.messageId, buffer, false);
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ code, message }) });
    }
  });
});

// POST /api/chat/system —— 題目切換的系統訊息（FR-019）
chatRoutes.post('/chat/system', requireSession, async (c) => {
  const sessionId = currentSessionId(c);
  const session = findSessionById(sessionId);
  if (!session) throw new AppError('UNAUTHORIZED');
  assertWritable(session.status);

  const parsed = chatSystemRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError('BAD_REQUEST');

  const { fromQuestionId, toQuestionId } = parsed.data;
  if (!isQuestionInSession(sessionId, toQuestionId)) throw new AppError('NOT_FOUND');

  const questions = listSessionQuestions(sessionId);
  const from = questions.find((q) => q.id === fromQuestionId);
  const to = questions.find((q) => q.id === toQuestionId);

  const message = insertChatMessage({
    sessionId,
    questionId: toQuestionId,
    role: 'system',
    content: `已切換至 Q${to?.order ?? '?'}「${to?.title ?? toQuestionId}」${
      from ? `（原本在 Q${from.order}「${from.title}」）` : ''
    }。接下來的討論會以這一題為準。`,
  });

  return c.json({ message }, 201);
});
