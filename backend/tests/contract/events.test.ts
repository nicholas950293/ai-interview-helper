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

describe('POST /api/events —— 環境事件（FR-025 / FR-026）', () => {
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

  const post = (body: unknown) =>
    app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

  const countEvents = () =>
    (
      fixture.db
        .prepare('SELECT COUNT(*) AS n FROM environment_event WHERE session_id = ?')
        .get(fixture.sessionId) as { n: number }
    ).n;

  it('記錄單筆事件並回 202', async () => {
    const res = await post([
      { type: 'tab_hidden', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 2500 },
    ]);

    expect(res.status).toBe(202);
    expect((await jsonOf(res)).accepted).toBe(1);
    expect(countEvents()).toBe(1);
  });

  it('批次記錄多筆', async () => {
    const res = await post([
      { type: 'tab_hidden', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 2000 },
      { type: 'window_blur', startedAt: '2026-08-04T10:01:00.000Z', durationMs: 3000 },
    ]);

    expect((await jsonOf(res)).accepted).toBe(2);
    expect(countEvents()).toBe(2);
  });

  it('durationMs < 1000 的項目伺服端靜默丟棄，不計入 accepted', async () => {
    const res = await post([
      { type: 'tab_hidden', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 999 },
      { type: 'window_blur', startedAt: '2026-08-04T10:01:00.000Z', durationMs: 1000 },
    ]);

    expect(res.status).toBe(202);
    expect((await jsonOf(res)).accepted).toBe(1);
    expect(countEvents()).toBe(1);
  });

  it('整批都低於門檻時回 202 且 accepted 為 0，不視為錯誤', async () => {
    const res = await post([
      { type: 'tab_hidden', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 100 },
    ]);

    expect(res.status).toBe(202);
    expect((await jsonOf(res)).accepted).toBe(0);
    expect(countEvents()).toBe(0);
  });

  it('僅記錄客觀事實，判定性欄位不會被寫入（FR-026）', async () => {
    await post([
      {
        type: 'tab_hidden',
        startedAt: '2026-08-04T10:00:00.000Z',
        durationMs: 2000,
        cheating: true,
        verdict: 'suspicious',
      },
    ]);

    const columns = (
      fixture.db.prepare('PRAGMA table_info(environment_event)').all() as { name: string }[]
    ).map((c) => c.name);

    expect(columns).toEqual(['id', 'session_id', 'type', 'started_at', 'duration_ms']);
    expect(columns).not.toContain('cheating');
    expect(columns).not.toContain('verdict');
  });

  it('不接受未定義的事件類型', async () => {
    const res = await post([
      { type: 'screenshot_taken', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 2000 },
    ]);
    expect(res.status).toBe(400);
  });

  it('場次已提交：拒絕記錄', async () => {
    setSessionStatus(fixture.db, fixture.sessionId, 'submitted');
    const res = await post([
      { type: 'tab_hidden', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 2000 },
    ]);
    expect(res.status).toBe(409);
  });

  it('未帶 cookie：回 401', async () => {
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { type: 'tab_hidden', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 2000 },
      ]),
    });
    expect(res.status).toBe(401);
  });

  it('所有切換記錄隨場次留存至提交後（US5 情境 3）', async () => {
    await post([
      { type: 'tab_hidden', startedAt: '2026-08-04T10:00:00.000Z', durationMs: 2000 },
      { type: 'window_blur', startedAt: '2026-08-04T10:01:00.000Z', durationMs: 5000 },
    ]);

    await app.request('/api/submit', { method: 'POST', headers: { cookie } });

    expect(countEvents()).toBe(2);
  });
});
