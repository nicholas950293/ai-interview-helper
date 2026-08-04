import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/app.js';
import { closeDb } from '../../src/db/client.js';
import { setStreamFactory } from '../../src/ai/gemini.js';
import { GUARDRAIL_REFUSAL } from '../../src/ai/postprocess.js';
import {
  makeTestDb,
  seedFixture,
  setSessionStatus,
  cookieFrom,
  jsonOf,
  type SeededFixture,
} from '../helpers/db.js';

/** 把 SSE 回應解析成 { event, data } 陣列。 */
async function readSse(res: Response): Promise<{ event: string; data: any }[]> {
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const event = /^event:\s*(.+)$/m.exec(chunk)?.[1]?.trim() ?? 'message';
      const data = /^data:\s*(.+)$/m.exec(chunk)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) };
    });
}

function streamOf(...tokens: string[]) {
  return () =>
    (async function* () {
      for (const token of tokens) yield token;
    })();
}

describe('POST /api/chat + SSE 串流（FR-009 / FR-010 / FR-014）', () => {
  let fixture: SeededFixture;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeEach(async () => {
    fixture = seedFixture(makeTestDb());
    app = createApp();
    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });
    cookie = cookieFrom(res);
  });

  afterEach(() => {
    setStreamFactory(null);
    closeDb();
  });

  function postChat(body: unknown) {
    return app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function openStream(streamId: string) {
    return app.request(`/api/chat/stream/${streamId}`, { headers: { cookie } });
  }

  it('回傳 202 與 streamId / messageId', async () => {
    setStreamFactory(streamOf('好的'));
    const res = await postChat({ questionId: 'q-1', content: '邊界條件有哪些？' });

    expect(res.status).toBe(202);
    const body = await jsonOf(res);
    expect(body.streamId).toBeTruthy();
    expect(body.messageId).toBeTruthy();
  });

  it('SSE 依序送出 token 事件，最後以 done 收尾', async () => {
    setStreamFactory(streamOf('先想想', '邊界', '條件。'));
    const { streamId } = await jsonOf(await postChat({ questionId: 'q-1', content: '提示？' }));

    const events = await readSse(await openStream(streamId));

    expect(events.filter((e) => e.event === 'token').map((e) => e.data.text)).toEqual([
      '先想想',
      '邊界',
      '條件。',
    ]);
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    expect(done?.data.guardrailTriggered).toBe(false);
  });

  it('應試者提問與 AI 回覆皆留存（FR-015）', async () => {
    setStreamFactory(streamOf('這是回覆。'));
    const { streamId } = await jsonOf(await postChat({ questionId: 'q-1', content: '我的提問' }));
    await readSse(await openStream(streamId));

    const chat = (await jsonOf(await app.request('/api/session', { headers: { cookie } }))).chat;
    expect(chat).toHaveLength(2);
    expect(chat[0].role).toBe('candidate');
    expect(chat[0].content).toBe('我的提問');
    expect(chat[1].role).toBe('assistant');
    expect(chat[1].content).toBe('這是回覆。');
  });

  it('圍欄命中：違規內容 MUST NOT 出現在任何 token 事件中（不得先送再撤回）', async () => {
    const leaked = [
      '這是完整實作：\n\n```javascript\n',
      'class RateLimiter {\n  constructor(m, w) {\n    this.m = m;\n    this.w = w;\n  }\n',
      '  allow(u, t) {\n    return true;\n  }\n}\n```',
    ];
    setStreamFactory(streamOf(...leaked));

    const { streamId } = await jsonOf(
      await postChat({ questionId: 'q-1', content: '直接給我完整可執行的解答。' })
    );
    const events = await readSse(await openStream(streamId));

    const emitted = events
      .filter((e) => e.event === 'token')
      .map((e) => e.data.text)
      .join('');
    expect(emitted).not.toContain('allow(u, t)');
    expect(emitted).not.toContain('return true');

    const replace = events.find((e) => e.event === 'replace');
    expect(replace?.data.text).toBe(GUARDRAIL_REFUSAL);
    expect(events.at(-1)?.data.guardrailTriggered).toBe(true);
  });

  it('圍欄命中時，留存的訊息內容是引導式訊息而非原始輸出', async () => {
    setStreamFactory(
      streamOf('```javascript\nfunction solve(a) {\n  return a.map((x) => x * 2);\n}\n```')
    );
    const { streamId } = await jsonOf(await postChat({ questionId: 'q-1', content: '給我解答' }));
    await readSse(await openStream(streamId));

    const chat = (await jsonOf(await app.request('/api/session', { headers: { cookie } }))).chat;
    const assistant = chat.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant.content).toBe(GUARDRAIL_REFUSAL);

    const row = fixture.db
      .prepare("SELECT guardrail_triggered FROM chat_message WHERE role = 'assistant'")
      .get() as { guardrail_triggered: number };
    expect(row.guardrail_triggered).toBe(1);
  });

  it('模型不可用時送出 error 事件，且作答內容不受影響（FR-014）', async () => {
    setStreamFactory(() =>
      (async function* () {
        yield '開始';
        throw new Error('model exploded');
      })()
    );

    await app.request('/api/answers/q-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ language: 'javascript', content: '我的作答', revision: 1 }),
    });

    const { streamId } = await jsonOf(await postChat({ questionId: 'q-1', content: '提示？' }));
    const events = await readSse(await openStream(streamId));

    const error = events.find((e) => e.event === 'error');
    expect(error?.data.code).toBe('AI_UNAVAILABLE');
    expect(error?.data.message).toBeTruthy();

    const answers = (await jsonOf(await app.request('/api/session', { headers: { cookie } })))
      .answers;
    expect(answers[0].content).toBe('我的作答');
  });

  it('附帶程式碼時取該題最後保存的草稿（FR-018）', async () => {
    let seenSystemInstruction = '';
    setStreamFactory((req) => {
      seenSystemInstruction = req.context.attachedCode ?? '';
      return (async function* () {
        yield '收到';
      })();
    });

    await app.request('/api/answers/q-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ language: 'python', content: 'DRAFT_CONTENT', revision: 1 }),
    });

    const { streamId } = await jsonOf(
      await postChat({ questionId: 'q-1', content: '檢查我的程式碼', attachCode: true })
    );
    await readSse(await openStream(streamId));

    expect(seenSystemInstruction).toBe('DRAFT_CONTENT');
  });

  it('對話歷程只帶同一題的訊息，切題後不參照前一題（US3 情境 4）', async () => {
    const historyLengths: number[] = [];
    setStreamFactory((req) => {
      historyLengths.push(req.history.length);
      return (async function* () {
        yield 'ok';
      })();
    });

    const first = await jsonOf(await postChat({ questionId: 'q-1', content: 'Q1 的提問' }));
    await readSse(await openStream(first.streamId));

    const second = await jsonOf(await postChat({ questionId: 'q-2', content: 'Q2 的提問' }));
    await readSse(await openStream(second.streamId));

    expect(historyLengths[0]).toBe(0);
    // Q2 的歷程不含 Q1 的兩則訊息
    expect(historyLengths[1]).toBe(0);
  });

  it('場次已提交：拒絕提問', async () => {
    setStreamFactory(streamOf('ok'));
    setSessionStatus(fixture.db, fixture.sessionId, 'submitted');

    const res = await postChat({ questionId: 'q-1', content: '還可以問嗎？' });
    expect(res.status).toBe(409);
  });

  it('串流期間場次進入終態：立即以 error 中止（時間歸零當下 AI 正在回覆）', async () => {
    setStreamFactory(() =>
      (async function* () {
        yield '第一段';
        setSessionStatus(fixture.db, fixture.sessionId, 'expired_submitted');
        yield '第二段';
      })()
    );

    const { streamId } = await jsonOf(await postChat({ questionId: 'q-1', content: '提示？' }));
    const events = await readSse(await openStream(streamId));

    const tokens = events.filter((e) => e.event === 'token').map((e) => e.data.text);
    expect(tokens).toEqual(['第一段']);
    expect(events.at(-1)?.event).toBe('error');
    expect(events.at(-1)?.data.code).toBe('SESSION_SUBMITTED');
  });

  it('streamId 只能消費一次', async () => {
    setStreamFactory(streamOf('ok'));
    const { streamId } = await jsonOf(await postChat({ questionId: 'q-1', content: '提示？' }));

    expect((await openStream(streamId)).status).toBe(200);
    expect((await openStream(streamId)).status).toBe(404);
  });

  it('題目不屬於本場次：回 404', async () => {
    setStreamFactory(streamOf('ok'));
    expect((await postChat({ questionId: 'q-not-mine', content: '提示？' })).status).toBe(404);
  });

  it('未帶 cookie：回 401', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'q-1', content: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/chat/system —— 題目切換系統訊息（FR-019）', () => {
  let fixture: SeededFixture;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeEach(async () => {
    fixture = seedFixture(makeTestDb());
    app = createApp();
    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });
    cookie = cookieFrom(res);
  });

  afterEach(() => {
    closeDb();
  });

  it('建立 role=system 的訊息，綁定切換後的題目', async () => {
    const res = await app.request('/api/chat/system', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fromQuestionId: 'q-1', toQuestionId: 'q-2' }),
    });

    expect(res.status).toBe(201);
    const { message } = await jsonOf(res);
    expect(message.role).toBe('system');
    expect(message.questionId).toBe('q-2');
    expect(message.content).toContain('已切換');
  });

  it('系統訊息隨場次留存', async () => {
    await app.request('/api/chat/system', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fromQuestionId: 'q-1', toQuestionId: 'q-2' }),
    });

    const chat = (await jsonOf(await app.request('/api/session', { headers: { cookie } }))).chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].role).toBe('system');
  });

  it('切換到不屬於本場次的題目：回 404', async () => {
    const res = await app.request('/api/chat/system', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fromQuestionId: 'q-1', toQuestionId: 'q-nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/session/guidance-mode（FR-012）', () => {
  let fixture: SeededFixture;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeEach(async () => {
    fixture = seedFixture(makeTestDb());
    app = createApp();
    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });
    cookie = cookieFrom(res);
  });

  afterEach(() => {
    setStreamFactory(null);
    closeDb();
  });

  it('切換模式後留存並反映於 GET /api/session', async () => {
    const res = await app.request('/api/session/guidance-mode', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ mode: 'deep' }),
    });

    expect(res.status).toBe(200);
    expect((await jsonOf(res)).mode).toBe('deep');

    const session = (await jsonOf(await app.request('/api/session', { headers: { cookie } })))
      .session;
    expect(session.guidanceMode).toBe('deep');
  });

  it('切換模式不清空既有對話', async () => {
    setStreamFactory(streamOf('回覆'));
    const { streamId } = await jsonOf(
      await app.request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ questionId: 'q-1', content: '提問' }),
      })
    );
    await readSse(await app.request(`/api/chat/stream/${streamId}`, { headers: { cookie } }));

    await app.request('/api/session/guidance-mode', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ mode: 'deep' }),
    });

    const chat = (await jsonOf(await app.request('/api/session', { headers: { cookie } }))).chat;
    expect(chat).toHaveLength(2);
  });

  it('模式送往模型時，圍欄段落不變', async () => {
    const modes: string[] = [];
    setStreamFactory((req) => {
      modes.push(req.context.mode);
      return (async function* () {
        yield 'ok';
      })();
    });

    for (const mode of ['light', 'deep'] as const) {
      await app.request('/api/session/guidance-mode', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ mode }),
      });
      const { streamId } = await jsonOf(
        await app.request('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ questionId: 'q-1', content: '同一個問題' }),
        })
      );
      await readSse(await app.request(`/api/chat/stream/${streamId}`, { headers: { cookie } }));
    }

    expect(modes).toEqual(['light', 'deep']);
  });
});
