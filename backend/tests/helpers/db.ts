import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { setDb, type Db } from '../../src/db/client.js';
import { nowIso } from '../../src/db/queries.js';
import type { GuidanceMode, SessionStatus } from '../../src/lib/schemas.js';

export interface SeedOptions {
  sessionId?: string;
  token?: string;
  durationSec?: number;
  status?: SessionStatus;
  startedAt?: string | null;
  deadlineAt?: string | null;
  tokenExpiresAt?: string;
  guidanceMode?: GuidanceMode;
  questionCount?: number;
}

export interface SeededFixture {
  db: Db;
  sessionId: string;
  token: string;
  questionIds: string[];
}

/** 每個測試檔一個獨立的記憶體資料庫，避免測試之間互相污染。 */
export function makeTestDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return db;
}

const STARTER_CODE = {
  javascript: 'function solve() {\n  // 在此作答\n}\n',
  typescript: 'function solve(): void {\n  // 在此作答\n}\n',
  python: 'def solve():\n    # 在此作答\n    pass\n',
  go: 'func solve() {\n\t// 在此作答\n}\n',
};

export function seedFixture(db: Db, options: SeedOptions = {}): SeededFixture {
  const sessionId = options.sessionId ?? 'sess-test-1';
  const token = options.token ?? 'tok-test-1';
  const durationSec = options.durationSec ?? 3600;
  const status = options.status ?? 'not_started';
  const questionCount = options.questionCount ?? 2;
  const tokenExpiresAt =
    options.tokenExpiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  db.prepare(
    `INSERT INTO interview_session
       (id, candidate_name, position_title, duration_sec, started_at, deadline_at, status, guidance_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    'Alex Chen',
    '資深全端工程師模擬面試',
    durationSec,
    options.startedAt ?? null,
    options.deadlineAt ?? null,
    status,
    options.guidanceMode ?? 'light'
  );

  db.prepare(
    `INSERT INTO invite_token (token, session_id, status, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(token, sessionId, status === 'not_started' ? 'pending' : 'active', tokenExpiresAt);

  const questionIds: string[] = [];
  // 題目 id 以 sessionId 為前綴，讓同一個資料庫可以容納多組 fixture。
  const questionPrefix = sessionId === 'sess-test-1' ? 'q' : `q-${sessionId}`;
  for (let i = 1; i <= questionCount; i += 1) {
    const qid = `${questionPrefix}-${i}`;
    questionIds.push(qid);
    db.prepare(
      `INSERT INTO question
         (id, title, difficulty, points, description, examples_json, complexity_requirement,
          grading_focus_json, starter_code_json, predefined_tests_json, quick_prompts_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      qid,
      `示範題目 ${i}`,
      'medium',
      40,
      `題目 ${i} 的描述`,
      JSON.stringify([{ input: 'a', output: 'b' }]),
      'O(1) 時間複雜度',
      JSON.stringify(['邊界條件處理']),
      JSON.stringify(STARTER_CODE),
      JSON.stringify([
        { name: 'case-1', expectedPass: true },
        { name: 'case-2', expectedPass: true },
        { name: 'case-3', expectedPass: false },
      ]),
      JSON.stringify(['檢查 Corner Cases', '分析時間複雜度'])
    );
    db.prepare(
      'INSERT INTO session_question (session_id, question_id, "order") VALUES (?, ?, ?)'
    ).run(sessionId, qid, i);
  }

  return { db, sessionId, token, questionIds };
}

export function setSessionStatus(db: Db, sessionId: string, status: SessionStatus): void {
  db.prepare('UPDATE interview_session SET status = ?, submitted_at = ? WHERE id = ?').run(
    status,
    status === 'submitted' || status === 'expired_submitted' ? nowIso() : null,
    sessionId
  );
}

/** 從 Set-Cookie 標頭取出可直接回傳的 Cookie 標頭值。 */
export function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('回應未包含 Set-Cookie');
  return setCookie.split(';')[0] ?? '';
}

/** 契約測試常需讀取任意形狀的回應；集中在此避免每個測試檔都寫型別轉換。 */
export async function jsonOf(res: Response): Promise<any> {
  return res.json();
}
