import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/app.js';
import { closeDb } from '../../src/db/client.js';
import {
  makeTestDb,
  seedFixture,
  setSessionStatus,
  cookieFrom,
  jsonOf,
  type SeededFixture,
} from '../helpers/db.js';

describe('POST /api/submit —— 手動提交（FR-021 / FR-022）', () => {
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

  const submit = () => app.request('/api/submit', { method: 'POST', headers: { cookie } });

  const save = (questionId: string, content: string, revision: number) =>
    app.request(`/api/answers/${questionId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ language: 'javascript', content, revision }),
    });

  it('提交成功回傳 submittedAt 與 status', async () => {
    const res = await submit();

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.status).toBe('submitted');
    expect(body.submittedAt).toBeTruthy();
  });

  it('冪等：重複呼叫回傳既有結果，不視為錯誤', async () => {
    const first = await jsonOf(await submit());
    const second = await submit();

    expect(second.status).toBe(200);
    expect((await jsonOf(second)).submittedAt).toBe(first.submittedAt);
  });

  it('不接受作答內容；伺服端取的是最後保存的草稿（FR-022）', async () => {
    await save('q-1', 'v1', 1);
    await save('q-1', 'v2', 2);

    await app.request('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ answers: [{ questionId: 'q-1', content: '偽造的內容' }] }),
    });

    const row = fixture.db
      .prepare('SELECT content FROM answer WHERE session_id = ? AND question_id = ?')
      .get(fixture.sessionId, 'q-1') as { content: string };
    expect(row.content).toBe('v2');
  });

  it('提交後所有寫入端點回 SESSION_SUBMITTED', async () => {
    await submit();

    expect((await save('q-1', 'late', 1)).status).toBe(409);
    expect(
      (
        await app.request('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ questionId: 'q-1', content: '還能問嗎' }),
        })
      ).status
    ).toBe(409);
    expect(
      (
        await app.request('/api/tests/q-1', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({}),
        })
      ).status
    ).toBe(409);
  });

  it('提交不清除已保存的作答內容（FR-023）', async () => {
    await save('q-1', '我的作答', 1);
    await submit();

    const answers = (await jsonOf(await app.request('/api/session', { headers: { cookie } })))
      .answers;
    expect(answers[0].content).toBe('我的作答');
  });

  it('未帶 cookie：回 401', async () => {
    expect((await app.request('/api/submit', { method: 'POST' })).status).toBe(401);
  });
});

describe('GET /api/time —— 校時與逾時強制提交（R-007 / FR-022）', () => {
  let fixture: SeededFixture;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  async function enter(durationSec: number) {
    fixture = seedFixture(makeTestDb(), { durationSec });
    app = createApp();
    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });
    cookie = cookieFrom(res);
  }

  afterEach(() => {
    closeDb();
  });

  it('回傳 serverTime、deadlineAt 與 status', async () => {
    await enter(3600);
    const res = await app.request('/api/time', { headers: { cookie } });

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.serverTime).toBeTruthy();
    expect(body.deadlineAt).toBeTruthy();
    expect(body.status).toBe('in_progress');
  });

  it('逾期時主動觸發強制提交，不依賴前端通報', async () => {
    await enter(3600);
    // 直接把 deadline 撥到過去，模擬時間歸零
    fixture.db
      .prepare('UPDATE interview_session SET deadline_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), fixture.sessionId);

    const body = await jsonOf(await app.request('/api/time', { headers: { cookie } }));

    expect(body.status).toBe('expired_submitted');

    const row = fixture.db
      .prepare('SELECT status, submitted_at FROM interview_session WHERE id = ?')
      .get(fixture.sessionId) as { status: string; submitted_at: string | null };
    expect(row.status).toBe('expired_submitted');
    expect(row.submitted_at).toBeTruthy();
  });

  it('逾時提交後的寫入一律拒絕，作答內容保留', async () => {
    await enter(3600);
    await app.request('/api/answers/q-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ language: 'javascript', content: '歸零前的最後內容', revision: 1 }),
    });

    fixture.db
      .prepare('UPDATE interview_session SET deadline_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), fixture.sessionId);
    await app.request('/api/time', { headers: { cookie } });

    const late = await app.request('/api/answers/q-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ language: 'javascript', content: '歸零後的內容', revision: 2 }),
    });
    expect(late.status).toBe(409);

    const row = fixture.db
      .prepare('SELECT content FROM answer WHERE session_id = ? AND question_id = ?')
      .get(fixture.sessionId, 'q-1') as { content: string };
    expect(row.content).toBe('歸零前的最後內容');
  });

  it('已手動提交的場次不會被改成 expired_submitted', async () => {
    await enter(3600);
    await app.request('/api/submit', { method: 'POST', headers: { cookie } });

    fixture.db
      .prepare('UPDATE interview_session SET deadline_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), fixture.sessionId);

    const body = await jsonOf(await app.request('/api/time', { headers: { cookie } }));
    expect(body.status).toBe('submitted');
  });

  it('逾期後才呼叫 POST /api/submit：回傳既有的逾時提交結果，不覆寫終態', async () => {
    await enter(3600);
    fixture.db
      .prepare('UPDATE interview_session SET deadline_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), fixture.sessionId);
    await app.request('/api/time', { headers: { cookie } });

    const res = await app.request('/api/submit', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).status).toBe('expired_submitted');
  });

  it('deadline 尚未到達時不觸發提交', async () => {
    await enter(3600);
    const before = await jsonOf(await app.request('/api/time', { headers: { cookie } }));
    expect(before.status).toBe('in_progress');
  });

  it('場次已提交時仍可校時（前端需要知道終態）', async () => {
    await enter(3600);
    setSessionStatus(fixture.db, fixture.sessionId, 'submitted');

    const res = await app.request('/api/time', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).status).toBe('submitted');
  });
});
