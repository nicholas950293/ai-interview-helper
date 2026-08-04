import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/app.js';
import { closeDb } from '../../src/db/client.js';
import { MAX_CONTENT_BYTES } from '../../src/lib/schemas.js';
import {
  makeTestDb,
  seedFixture,
  setSessionStatus,
  cookieFrom,
  jsonOf,
  type SeededFixture,
} from '../helpers/db.js';

describe('PUT /api/answers/:questionId —— 草稿保存（FR-004 / FR-028）', () => {
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

  function save(questionId: string, body: unknown) {
    return app.request(`/api/answers/${questionId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  it('首次保存回傳 savedAt 與 revision', async () => {
    const res = await save('q-1', { language: 'javascript', content: 'hello', revision: 1 });

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.revision).toBe(1);
    expect(body.savedAt).toBeTruthy();
  });

  it('revision 遞增的連續保存皆成功', async () => {
    await save('q-1', { language: 'javascript', content: 'v1', revision: 1 });
    const res = await save('q-1', { language: 'javascript', content: 'v2', revision: 2 });

    expect(res.status).toBe(200);
    expect((await jsonOf(res)).revision).toBe(2);
  });

  it('revision 落後：回 409 REVISION_STALE，並附帶伺服端現值供前端修復', async () => {
    await save('q-1', { language: 'javascript', content: 'newer', revision: 5 });
    const res = await save('q-1', { language: 'javascript', content: 'older', revision: 3 });

    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('REVISION_STALE');
    expect(body.error.details.revision).toBe(5);
  });

  it('revision 落後時，伺服端既有內容 MUST NOT 被覆蓋', async () => {
    await save('q-1', { language: 'javascript', content: 'newer', revision: 5 });
    await save('q-1', { language: 'javascript', content: 'older', revision: 3 });

    const row = fixture.db
      .prepare('SELECT content, revision FROM answer WHERE session_id = ? AND question_id = ?')
      .get(fixture.sessionId, 'q-1') as { content: string; revision: number };
    expect(row.content).toBe('newer');
    expect(row.revision).toBe(5);
  });

  it('內容超過 256 KB：回 413 CONTENT_TOO_LARGE，且不靜默截斷', async () => {
    const oversized = 'x'.repeat(MAX_CONTENT_BYTES + 1);
    const res = await save('q-1', { language: 'javascript', content: oversized, revision: 1 });

    expect(res.status).toBe(413);
    expect((await jsonOf(res)).error.code).toBe('CONTENT_TOO_LARGE');

    const row = fixture.db
      .prepare('SELECT content FROM answer WHERE session_id = ? AND question_id = ?')
      .get(fixture.sessionId, 'q-1');
    expect(row).toBeUndefined();
  });

  it('場次已提交：回 409 SESSION_SUBMITTED，拒絕寫入', async () => {
    setSessionStatus(fixture.db, fixture.sessionId, 'submitted');
    const res = await save('q-1', { language: 'javascript', content: 'late', revision: 1 });

    expect(res.status).toBe(409);
    expect((await jsonOf(res)).error.code).toBe('SESSION_SUBMITTED');
  });

  it('逾時提交的場次同樣拒絕寫入', async () => {
    setSessionStatus(fixture.db, fixture.sessionId, 'expired_submitted');
    const res = await save('q-1', { language: 'javascript', content: 'late', revision: 1 });

    expect(res.status).toBe(409);
  });

  it('題目不屬於本場次：回 404', async () => {
    const res = await save('q-not-mine', { language: 'javascript', content: 'x', revision: 1 });
    expect(res.status).toBe(404);
  });

  it('未帶 cookie：回 401', async () => {
    const res = await app.request('/api/answers/q-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'javascript', content: 'x', revision: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('每題各自保存，切換題目時互不覆蓋（FR-003）', async () => {
    await save('q-1', { language: 'javascript', content: 'answer-1', revision: 1 });
    await save('q-2', { language: 'python', content: 'answer-2', revision: 1 });

    const res = await app.request('/api/session', { headers: { cookie } });
    const body = await jsonOf(res);
    const byId = Object.fromEntries(
      body.answers.map((a: { questionId: string }) => [a.questionId, a])
    );

    expect(byId['q-1'].content).toBe('answer-1');
    expect(byId['q-1'].language).toBe('javascript');
    expect(byId['q-2'].content).toBe('answer-2');
    expect(byId['q-2'].language).toBe('python');
  });
});

describe('PUT /api/answers —— 離線批次補送', () => {
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

  function saveBatch(body: unknown) {
    return app.request('/api/answers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  it('依 revision 排序套用，最終內容為最高 revision 的那筆', async () => {
    const res = await saveBatch([
      { questionId: 'q-1', language: 'javascript', content: 'v3', revision: 3 },
      { questionId: 'q-1', language: 'javascript', content: 'v1', revision: 1 },
      { questionId: 'q-1', language: 'javascript', content: 'v2', revision: 2 },
    ]);

    expect(res.status).toBe(200);
    const row = fixture.db
      .prepare('SELECT content, revision FROM answer WHERE session_id = ? AND question_id = ?')
      .get(fixture.sessionId, 'q-1') as { content: string; revision: number };
    expect(row.content).toBe('v3');
    expect(row.revision).toBe(3);
  });

  it('批次中的落後 revision 被略過，不視為整批失敗', async () => {
    await saveBatch([{ questionId: 'q-1', language: 'javascript', content: 'v5', revision: 5 }]);
    const res = await saveBatch([
      { questionId: 'q-1', language: 'javascript', content: 'stale', revision: 2 },
      { questionId: 'q-2', language: 'go', content: 'fresh', revision: 1 },
    ]);

    expect(res.status).toBe(200);
    const q1 = fixture.db
      .prepare('SELECT content FROM answer WHERE session_id = ? AND question_id = ?')
      .get(fixture.sessionId, 'q-1') as { content: string };
    const q2 = fixture.db
      .prepare('SELECT content FROM answer WHERE session_id = ? AND question_id = ?')
      .get(fixture.sessionId, 'q-2') as { content: string };
    expect(q1.content).toBe('v5');
    expect(q2.content).toBe('fresh');
  });

  it('場次已提交時整批拒絕', async () => {
    setSessionStatus(fixture.db, fixture.sessionId, 'submitted');
    const res = await saveBatch([
      { questionId: 'q-1', language: 'javascript', content: 'x', revision: 1 },
    ]);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/tests/:questionId —— 執行單元測試（FR-008 / FR-030）', () => {
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

  it('回報預定義的通過數與總數', async () => {
    const res = await app.request('/api/tests/q-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.total).toBe(3);
    expect(body.passed).toBe(2);
    expect(body.ranAt).toBeTruthy();
  });

  it('回應 MUST NOT 包含個別測試案例的名稱或期望值', async () => {
    const res = await app.request('/api/tests/q-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    });
    const raw = await res.text();

    expect(raw).not.toContain('case-1');
    expect(raw).not.toContain('expectedPass');
  });

  it('MUST NOT 接受或執行任何用戶端提供的程式碼', async () => {
    const res = await app.request('/api/tests/q-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ code: 'process.exit(1)', language: 'javascript' }),
    });

    // 額外欄位被忽略，結果仍來自預定義測試
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).total).toBe(3);
  });

  it('執行結果留存於 test_run', async () => {
    await app.request('/api/tests/q-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    });

    const row = fixture.db
      .prepare('SELECT COUNT(*) AS n FROM test_run WHERE session_id = ?')
      .get(fixture.sessionId) as { n: number };
    expect(row.n).toBe(1);
  });

  it('場次已提交時拒絕執行', async () => {
    setSessionStatus(fixture.db, fixture.sessionId, 'submitted');
    const res = await app.request('/api/tests/q-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });
});
