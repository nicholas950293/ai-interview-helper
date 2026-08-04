import { useSessionStore } from './session';
import { flushPendingSave } from './persistence';
import { ApiError, postChat, postChatSystemMessage } from '../services/api';
import { openChatStream, type StreamController } from '../services/chat-stream';
import type { ChatSource } from '../types';

/**
 * 跨模組的動作編排。
 *
 * 放在獨立模組而非 session.ts：`persistence` 依賴 store，store 若反過來
 * 依賴 persistence 會形成模組載入期的循環（實測會踩到 TDZ）。
 * 這裡是唯一同時依賴兩者的地方，方向維持單向。
 */

/**
 * 切換題目（contracts/ui-contracts.md A-01）。
 *
 *   1. flushPendingSave() —— 未保存的變更先落地，否則切走就遺失
 *   2. setCurrentQuestion() —— 三個面板同時看到新題目；尚無作答的題目載入 starter code
 *   3. POST /api/chat/system —— 於 Feed 記錄切換，使對話歷程可追溯到當時的題目脈絡
 *   4. StatusBar 與 Chips 訂閱 currentQuestion，自動反映，不需另行通知
 */
export async function switchQuestion(questionId: string): Promise<void> {
  const store = useSessionStore.getState();
  const fromQuestionId = store.currentQuestionId;
  if (questionId === fromQuestionId) return;

  await flushPendingSave();
  useSessionStore.getState().setCurrentQuestion(questionId);

  // 系統訊息失敗不該擋住切題——應試者已經在新題目上了。
  try {
    const { message } = await postChatSystemMessage({ fromQuestionId, toQuestionId: questionId });
    useSessionStore.getState().appendChatMessage(message);
  } catch {
    useSessionStore.getState().appendChatMessage({
      id: `local-switch-${Date.now()}`,
      questionId,
      role: 'system',
      content: '已切換題目。接下來的討論會以這一題為準。',
      createdAt: new Date().toISOString(),
      attachedCode: null,
    });
  }
}

/**
 * 「詢問 AI 題目重點」（ui-contracts A-02）。
 *
 * questionId 由 `sendChat` 從 store 讀取——按鈕不傳參，
 * 因此不可能送出過期的題目（憲章原則 II）。
 */
export const QUESTION_HINT_PROMPT = '請簡要說明這道題目的核心評分要點。';

export function askQuestionHint(): Promise<void> {
  return sendChat({ content: QUESTION_HINT_PROMPT, source: 'question_hint' });
}

/** 「傳送至 AI 側邊欄」（ui-contracts A-03）—— attachCode 會先 flush 待保存的草稿。 */
export const CODE_REVIEW_PROMPT =
  '請檢查我目前的程式碼有哪些 Corner Case 沒處理到，以及可能的潛在缺陷。不要給我修好的版本，指出方向就好。';

export function sendCodeForReview(): Promise<void> {
  return sendChat({ content: CODE_REVIEW_PROMPT, attachCode: true, source: 'code_review' });
}

// --- AI 對話 ----------------------------------------------------------------

let activeStream: StreamController | null = null;

/** 中止進行中的串流（時間歸零、場次結束）。 */
export function abortActiveStream(): void {
  activeStream?.abort();
  activeStream = null;
  useSessionStore.getState().setStreaming({ active: false });
}

export interface SendChatOptions {
  content: string;
  attachCode?: boolean;
  source?: ChatSource;
}

/**
 * 送出提問並接收串流回覆。
 *
 * Context 一律從 store 讀取（憲章原則 II）——呼叫端只傳提問內容，
 * 不傳 questionId，避免面板各自持有可能過期的快照。
 */
export async function sendChat({
  content,
  attachCode = false,
  source = 'typed',
}: SendChatOptions): Promise<void> {
  const store = useSessionStore.getState();
  const questionId = store.currentQuestionId;
  if (!questionId || store.streaming.active) return;

  // 附帶程式碼前 MUST 先 flush，否則伺服端取到的是舊草稿（ui-contracts A-03）
  if (attachCode) {
    await flushPendingSave();

    if (useSessionStore.getState().connectivity === 'offline') {
      useSessionStore.getState().appendChatMessage({
        id: `local-offline-${Date.now()}`,
        questionId,
        role: 'system',
        content: '目前離線，程式碼尚未同步至伺服端，因此沒有送出。恢復連線後可再試一次。',
        createdAt: new Date().toISOString(),
        attachedCode: null,
      });
      return;
    }
  }

  const attachedCode = attachCode
    ? (useSessionStore.getState().answers[questionId]?.content ?? '')
    : null;

  // 樂觀呈現：提問先出現在 Feed，不等伺服端回應
  const localId = `local-${Date.now()}`;
  useSessionStore.getState().appendChatMessage({
    id: localId,
    questionId,
    role: 'candidate',
    content,
    createdAt: new Date().toISOString(),
    attachedCode,
  });

  let streamId: string;
  let messageId: string;

  try {
    const result = await postChat({ questionId, content, attachCode, source });
    streamId = result.streamId;
    messageId = result.messageId;
  } catch (err) {
    useSessionStore.getState().appendChatMessage({
      id: `local-error-${Date.now()}`,
      questionId,
      role: 'system',
      content:
        err instanceof ApiError
          ? err.message
          : 'AI 助教目前無法回應，你的作答內容不受影響，稍後可再試一次。',
      createdAt: new Date().toISOString(),
      attachedCode: null,
    });
    return;
  }

  useSessionStore.getState().appendChatMessage({
    id: messageId,
    questionId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    attachedCode: null,
    pending: true,
  });
  useSessionStore.getState().setStreaming({ active: true, messageId });

  activeStream = openChatStream(streamId, {
    onToken: (text) => useSessionStore.getState().appendStreamToken(messageId, text),
    onReplace: (text) =>
      useSessionStore.getState().replaceChatMessage(messageId, { content: text }),
    onDone: () => {
      useSessionStore.getState().replaceChatMessage(messageId, { pending: false });
      useSessionStore.getState().setStreaming({ active: false });
      activeStream = null;
    },
    onError: (payload) => {
      useSessionStore.getState().replaceChatMessage(messageId, { pending: false });
      useSessionStore.getState().setStreaming({ active: false });
      activeStream = null;
      useSessionStore.getState().appendChatMessage({
        id: `local-error-${Date.now()}`,
        questionId,
        role: 'system',
        content: payload.message,
        createdAt: new Date().toISOString(),
        attachedCode: null,
      });
    },
  });
}
