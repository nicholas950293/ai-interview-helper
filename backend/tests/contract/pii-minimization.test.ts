import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../src/app.js';
import { closeDb } from '../../src/db/client.js';
import { publicSessionSchema } from '../../src/lib/schemas.js';
import { toPublicSession, findSessionById } from '../../src/db/queries.js';
import { makeTestDb, seedFixture, cookieFrom, jsonOf, type SeededFixture } from '../helpers/db.js';

/**
 * FR-032 / 憲章「資料最小化」：
 * 前端 MUST 僅顯示必要的個人資訊（姓名與職稱）；
 * 其他個資 MUST NOT 進入前端狀態或送入模型 Context。
 *
 * 這組測試守的是 MUST NOT 那一半——正面實作再完整，也需要有人斷言「沒有多的」。
 */
const ALLOWED_SESSION_FIELDS = [
  'id',
  'candidateName',
  'positionTitle',
  'deadlineAt',
  'status',
  'guidanceMode',
];

describe('個資最小化（FR-032）', () => {
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

  it('GET /api/session 的 session 只含允許的欄位', async () => {
    const body = await jsonOf(await app.request('/api/session', { headers: { cookie } }));
    expect(Object.keys(body.session).sort()).toEqual([...ALLOWED_SESSION_FIELDS].sort());
  });

  it('POST /api/session/redeem 的 session 同樣只含允許的欄位', async () => {
    const res = await app.request('/api/session/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: fixture.token }),
    });
    const body = await jsonOf(res);
    expect(Object.keys(body.session).sort()).toEqual([...ALLOWED_SESSION_FIELDS].sort());
  });

  it('toPublicSession 是唯一出口，且不外洩內部欄位', () => {
    const row = findSessionById(fixture.sessionId);
    expect(row).toBeDefined();

    const publicSession = toPublicSession(row!);

    // 內部欄位（總時長、開始時間、提交時間、建立時間）不得外流
    expect(publicSession).not.toHaveProperty('duration_sec');
    expect(publicSession).not.toHaveProperty('started_at');
    expect(publicSession).not.toHaveProperty('submitted_at');
    expect(publicSession).not.toHaveProperty('created_at');

    // schema 為 strict 白名單：多一個欄位就會失敗
    expect(publicSessionSchema.strict().safeParse(publicSession).success).toBe(true);
  });

  it('回應中不含 token —— 兌換後 token 不再出現於任何請求或回應（R-009）', async () => {
    const raw = await (await app.request('/api/session', { headers: { cookie } })).text();
    expect(raw).not.toContain(fixture.token);
  });

  it('題目回應不含 predefinedTests，作答回應不含伺服端內部欄位', async () => {
    await app.request('/api/answers/q-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ language: 'javascript', content: 'x', revision: 1 }),
    });

    const body = await jsonOf(await app.request('/api/session', { headers: { cookie } }));

    expect(Object.keys(body.answers[0]).sort()).toEqual(
      ['questionId', 'language', 'content', 'savedAt', 'revision'].sort()
    );
    expect(body.questions[0]).not.toHaveProperty('predefinedTests');
  });

  it('對話訊息不外洩 guardrailTriggered 等伺服端稽核欄位', async () => {
    await app.request('/api/chat/system', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fromQuestionId: 'q-1', toQuestionId: 'q-2' }),
    });

    const body = await jsonOf(await app.request('/api/session', { headers: { cookie } }));

    expect(Object.keys(body.chat[0]).sort()).toEqual(
      ['id', 'questionId', 'role', 'content', 'createdAt', 'attachedCode'].sort()
    );
    expect(body.chat[0]).not.toHaveProperty('guardrailTriggered');
    expect(body.chat[0]).not.toHaveProperty('guidanceMode');
  });

  it('資料表本身不含超出範圍的個資欄位', () => {
    const columns = (
      fixture.db.prepare('PRAGMA table_info(interview_session)').all() as { name: string }[]
    ).map((c) => c.name);

    for (const forbidden of ['email', 'phone', 'resume', 'address', 'birthday', 'gender']) {
      expect(columns).not.toContain(forbidden);
    }
  });
});
