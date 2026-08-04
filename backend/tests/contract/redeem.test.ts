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

describe('POST /api/session/redeem —— 邀請 token 兌換（FR-027）', () => {
  let fixture: SeededFixture;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    fixture = seedFixture(makeTestDb());
    app = createApp();
  });

  afterEach(() => {
    closeDb();
  });

  it('首次兌換：寫入 startedAt 與 deadlineAt，狀態轉為 in_progress，並換發 session cookie', async () => {
    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });

    expect(res.status).toBe(200);
    const body = await jsonOf(res);

    expect(body.session.status).toBe('in_progress');
    expect(body.session.candidateName).toBe('Alex Chen');
    expect(body.session.deadlineAt).toBeTruthy();
    expect(body.serverTime).toBeTruthy();

    // deadlineAt = startedAt + durationSec（伺服端計算，不接受用戶端傳入）
    const row = fixture.db
      .prepare('SELECT started_at, deadline_at FROM interview_session WHERE id = ?')
      .get(fixture.sessionId) as { started_at: string; deadline_at: string };
    const elapsed = Date.parse(row.deadline_at) - Date.parse(row.started_at);
    expect(elapsed).toBe(3600 * 1000);

    // 換發 HttpOnly session cookie，後續請求以 cookie 授權
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toMatch(/session=/);
  });

  it('重複兌換且場次仍 in_progress：回傳既有場次，MUST NOT 重置 deadlineAt', async () => {
    const first = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });
    const firstBody = await jsonOf(first);

    const second = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });
    const secondBody = await jsonOf(second);

    expect(second.status).toBe(200);
    expect(secondBody.session.deadlineAt).toBe(firstBody.session.deadlineAt);
    expect(secondBody.session.status).toBe('in_progress');
  });

  it('token 不存在：回 404 TOKEN_INVALID', async () => {
    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'does-not-exist' }),
    });

    expect(res.status).toBe(404);
    const body = await jsonOf(res);
    expect(body.error.code).toBe('TOKEN_INVALID');
    expect(body.error.message).toBeTruthy();
  });

  it('token 逾期：回 410 TOKEN_EXPIRED', async () => {
    seedFixture(fixture.db, {
      sessionId: 'sess-expired',
      token: 'tok-expired',
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok-expired' }),
    });

    expect(res.status).toBe(410);
    expect((await jsonOf(res)).error.code).toBe('TOKEN_EXPIRED');
  });

  it('場次已提交：回 409 SESSION_SUBMITTED，不得進入可作答狀態（FR-031）', async () => {
    setSessionStatus(fixture.db, fixture.sessionId, 'submitted');

    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });

    expect(res.status).toBe(409);
    expect((await jsonOf(res)).error.code).toBe('SESSION_SUBMITTED');
  });

  it('逾時提交的場次同樣拒絕進入', async () => {
    setSessionStatus(fixture.db, fixture.sessionId, 'expired_submitted');

    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });

    expect(res.status).toBe(409);
    expect((await jsonOf(res)).error.code).toBe('SESSION_SUBMITTED');
  });
});

describe('GET /api/session —— 場次還原（FR-003）', () => {
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

  it('回傳場次、題目、作答與對話，供重新整理時還原', async () => {
    const res = await app.request('/api/session', { headers: { cookie } });

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.session.id).toBe(fixture.sessionId);
    expect(body.questions).toHaveLength(2);
    expect(body.questions[0].order).toBe(1);
    expect(Array.isArray(body.answers)).toBe(true);
    expect(Array.isArray(body.chat)).toBe(true);
    expect(body.serverTime).toBeTruthy();
  });

  it('predefinedTests 的內容 MUST NOT 出現在回應中，僅回傳測試數量（FR-030）', async () => {
    const res = await app.request('/api/session', { headers: { cookie } });
    const raw = await res.text();

    expect(raw).not.toContain('predefinedTests');
    expect(raw).not.toContain('expectedPass');
    expect(raw).not.toContain('case-1');

    const body = JSON.parse(raw);
    expect(body.questions[0].testCount).toBe(3);
    expect(body.questions[0].predefinedTests).toBeUndefined();
  });

  it('未帶 cookie：回 401 UNAUTHORIZED', async () => {
    const res = await app.request('/api/session');
    expect(res.status).toBe(401);
    expect((await jsonOf(res)).error.code).toBe('UNAUTHORIZED');
  });

  it('偽造 cookie：回 401 UNAUTHORIZED（簽章驗證）', async () => {
    const res = await app.request('/api/session', {
      headers: { cookie: 'session=sess-test-1.forged-signature' },
    });
    expect(res.status).toBe(401);
  });
});
