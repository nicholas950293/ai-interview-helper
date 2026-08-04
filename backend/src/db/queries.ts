import { randomUUID } from 'node:crypto';
import { getDb, type Db } from './client.js';
import type {
  ChatRole,
  ChatSource,
  Difficulty,
  EnvironmentEventType,
  Example,
  GuidanceMode,
  InviteTokenStatus,
  Language,
  PublicAnswer,
  PublicChatMessage,
  PublicQuestion,
  PublicSession,
  SessionStatus,
  TestCase,
} from '../lib/schemas.js';

// --- 資料列型別（snake_case，對應 schema） ----------------------------------

interface SessionRow {
  id: string;
  candidate_name: string;
  position_title: string;
  duration_sec: number;
  started_at: string | null;
  deadline_at: string | null;
  status: SessionStatus;
  submitted_at: string | null;
  guidance_mode: GuidanceMode;
}

interface InviteTokenRow {
  token: string;
  session_id: string;
  status: InviteTokenStatus;
  expires_at: string;
  first_used_at: string | null;
}

interface QuestionRow {
  id: string;
  title: string;
  difficulty: Difficulty;
  points: number;
  description: string;
  examples_json: string;
  complexity_requirement: string;
  grading_focus_json: string;
  starter_code_json: string;
  predefined_tests_json: string;
  quick_prompts_json: string;
  order: number;
}

interface AnswerRow {
  session_id: string;
  question_id: string;
  language: Language;
  content: string;
  saved_at: string;
  revision: number;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  question_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
  attached_code: string | null;
  guidance_mode: GuidanceMode | null;
  guardrail_triggered: number;
  source: ChatSource | null;
}

export type Session = SessionRow;
export type InviteToken = InviteTokenRow;

export function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// --- 場次 -------------------------------------------------------------------

export function findSessionById(id: string, db: Db = getDb()): SessionRow | undefined {
  return db.prepare('SELECT * FROM interview_session WHERE id = ?').get(id) as
    SessionRow | undefined;
}

/**
 * 對外呈現的場次 —— 僅含姓名與職稱兩項個資（FR-032）。
 * 這是唯一允許將場次資料送往前端的轉換點；擴充欄位前 MUST 重新檢視個資最小化。
 */
export function toPublicSession(row: SessionRow): PublicSession {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    positionTitle: row.position_title,
    deadlineAt: row.deadline_at,
    status: row.status,
    guidanceMode: row.guidance_mode,
  };
}

export function updateSessionStatus(
  id: string,
  status: SessionStatus,
  submittedAt: string | null,
  db: Db = getDb()
): void {
  db.prepare('UPDATE interview_session SET status = ?, submitted_at = ? WHERE id = ?').run(
    status,
    submittedAt,
    id
  );
}

export function startSession(
  id: string,
  startedAt: string,
  deadlineAt: string,
  db: Db = getDb()
): void {
  db.prepare(
    `UPDATE interview_session
        SET started_at = ?, deadline_at = ?, status = 'in_progress'
      WHERE id = ?`
  ).run(startedAt, deadlineAt, id);
}

export function updateGuidanceMode(id: string, mode: GuidanceMode, db: Db = getDb()): void {
  db.prepare('UPDATE interview_session SET guidance_mode = ? WHERE id = ?').run(mode, id);
}

// --- 邀請連結 ---------------------------------------------------------------

export function findInviteToken(token: string, db: Db = getDb()): InviteTokenRow | undefined {
  return db.prepare('SELECT * FROM invite_token WHERE token = ?').get(token) as
    InviteTokenRow | undefined;
}

export function markTokenUsed(token: string, firstUsedAt: string, db: Db = getDb()): void {
  db.prepare(
    `UPDATE invite_token
        SET status = 'active', first_used_at = COALESCE(first_used_at, ?)
      WHERE token = ?`
  ).run(firstUsedAt, token);
}

export function markTokenConsumed(sessionId: string, db: Db = getDb()): void {
  db.prepare("UPDATE invite_token SET status = 'consumed' WHERE session_id = ?").run(sessionId);
}

// --- 題目 -------------------------------------------------------------------

function toPublicQuestion(row: QuestionRow): PublicQuestion {
  const predefined = parseJson<TestCase[]>(row.predefined_tests_json, []);
  return {
    id: row.id,
    title: row.title,
    difficulty: row.difficulty,
    points: row.points,
    description: row.description,
    examples: parseJson<Example[]>(row.examples_json, []),
    complexityRequirement: row.complexity_requirement,
    gradingFocus: parseJson<string[]>(row.grading_focus_json, []),
    starterCode: parseJson<Record<Language, string>>(row.starter_code_json, {} as never),
    quickPrompts: parseJson<string[]>(row.quick_prompts_json, []),
    order: row.order,
    // 只回傳數量，不回傳個別測試案例（FR-030 / contracts/http-api.md）
    testCount: predefined.length,
  };
}

export function listSessionQuestions(sessionId: string, db: Db = getDb()): PublicQuestion[] {
  const rows = db
    .prepare(
      `SELECT q.*, sq."order" AS "order"
         FROM session_question sq
         JOIN question q ON q.id = sq.question_id
        WHERE sq.session_id = ?
        ORDER BY sq."order" ASC`
    )
    .all(sessionId) as QuestionRow[];
  return rows.map(toPublicQuestion);
}

export function isQuestionInSession(
  sessionId: string,
  questionId: string,
  db: Db = getDb()
): boolean {
  const row = db
    .prepare('SELECT 1 AS ok FROM session_question WHERE session_id = ? AND question_id = ?')
    .get(sessionId, questionId);
  return row !== undefined;
}

/** 預定義測試案例 —— 僅供伺服端計算通過數，MUST NOT 出現在任何回應中。 */
export function getPredefinedTests(questionId: string, db: Db = getDb()): TestCase[] {
  const row = db
    .prepare('SELECT predefined_tests_json FROM question WHERE id = ?')
    .get(questionId) as { predefined_tests_json: string } | undefined;
  return row ? parseJson<TestCase[]>(row.predefined_tests_json, []) : [];
}

export function getStarterCode(questionId: string, db: Db = getDb()): Record<string, string> {
  const row = db.prepare('SELECT starter_code_json FROM question WHERE id = ?').get(questionId) as
    { starter_code_json: string } | undefined;
  return row ? parseJson<Record<string, string>>(row.starter_code_json, {}) : {};
}

// --- 作答 -------------------------------------------------------------------

function toPublicAnswer(row: AnswerRow): PublicAnswer {
  return {
    questionId: row.question_id,
    language: row.language,
    content: row.content,
    savedAt: row.saved_at,
    revision: row.revision,
  };
}

export function listAnswers(sessionId: string, db: Db = getDb()): PublicAnswer[] {
  const rows = db
    .prepare('SELECT * FROM answer WHERE session_id = ?')
    .all(sessionId) as AnswerRow[];
  return rows.map(toPublicAnswer);
}

export function findAnswer(
  sessionId: string,
  questionId: string,
  db: Db = getDb()
): PublicAnswer | undefined {
  const row = db
    .prepare('SELECT * FROM answer WHERE session_id = ? AND question_id = ?')
    .get(sessionId, questionId) as AnswerRow | undefined;
  return row ? toPublicAnswer(row) : undefined;
}

/**
 * 保存草稿。呼叫端 MUST 先以 revision 比對拒絕失序寫入；
 * 此處以 UPSERT 落地並回傳實際寫入的 savedAt / revision。
 */
export function upsertAnswer(
  input: {
    sessionId: string;
    questionId: string;
    language: Language;
    content: string;
    revision: number;
  },
  db: Db = getDb()
): { savedAt: string; revision: number } {
  const savedAt = nowIso();
  db.prepare(
    `INSERT INTO answer (session_id, question_id, language, content, saved_at, revision)
     VALUES (@sessionId, @questionId, @language, @content, @savedAt, @revision)
     ON CONFLICT (session_id, question_id) DO UPDATE SET
       language = excluded.language,
       content  = excluded.content,
       saved_at = excluded.saved_at,
       revision = excluded.revision`
  ).run({ ...input, savedAt });
  return { savedAt, revision: input.revision };
}

// --- 對話訊息 ---------------------------------------------------------------

function toPublicChatMessage(row: ChatMessageRow): PublicChatMessage {
  return {
    id: row.id,
    questionId: row.question_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    attachedCode: row.attached_code,
  };
}

export function listChatMessages(sessionId: string, db: Db = getDb()): PublicChatMessage[] {
  const rows = db
    .prepare('SELECT * FROM chat_message WHERE session_id = ? ORDER BY created_at ASC, id ASC')
    .all(sessionId) as ChatMessageRow[];
  return rows.map(toPublicChatMessage);
}

export interface InsertChatMessageInput {
  sessionId: string;
  questionId: string;
  role: ChatRole;
  content: string;
  attachedCode?: string | null;
  guidanceMode?: GuidanceMode | null;
  guardrailTriggered?: boolean;
  source?: ChatSource | null;
}

/** 所有訊息 MUST 留存（FR-015）；本模組不提供刪除介面。 */
export function insertChatMessage(
  input: InsertChatMessageInput,
  db: Db = getDb()
): PublicChatMessage {
  const id = randomUUID();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO chat_message
       (id, session_id, question_id, role, content, created_at,
        attached_code, guidance_mode, guardrail_triggered, source)
     VALUES (@id, @sessionId, @questionId, @role, @content, @createdAt,
             @attachedCode, @guidanceMode, @guardrailTriggered, @source)`
  ).run({
    id,
    sessionId: input.sessionId,
    questionId: input.questionId,
    role: input.role,
    content: input.content,
    createdAt,
    attachedCode: input.attachedCode ?? null,
    guidanceMode: input.guidanceMode ?? null,
    guardrailTriggered: input.guardrailTriggered ? 1 : 0,
    source: input.source ?? null,
  });

  return {
    id,
    questionId: input.questionId,
    role: input.role,
    content: input.content,
    createdAt,
    attachedCode: input.attachedCode ?? null,
  };
}

export function updateChatMessageContent(
  id: string,
  content: string,
  guardrailTriggered: boolean,
  db: Db = getDb()
): void {
  db.prepare('UPDATE chat_message SET content = ?, guardrail_triggered = ? WHERE id = ?').run(
    content,
    guardrailTriggered ? 1 : 0,
    id
  );
}

// --- 環境事件 ---------------------------------------------------------------

export function insertEnvironmentEvents(
  sessionId: string,
  events: { type: EnvironmentEventType; startedAt: string; durationMs: number }[],
  db: Db = getDb()
): number {
  const stmt = db.prepare(
    `INSERT INTO environment_event (id, session_id, type, started_at, duration_ms)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction((rows: typeof events) => {
    for (const e of rows) {
      stmt.run(randomUUID(), sessionId, e.type, e.startedAt, e.durationMs);
    }
  });
  insertAll(events);
  return events.length;
}

export function countEnvironmentEvents(sessionId: string, db: Db = getDb()): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM environment_event WHERE session_id = ?')
    .get(sessionId) as { n: number };
  return row.n;
}

// --- 測試結果 ---------------------------------------------------------------

export function insertTestRun(
  input: { sessionId: string; questionId: string; passed: number; total: number },
  db: Db = getDb()
): { passed: number; total: number; ranAt: string } {
  const ranAt = nowIso();
  db.prepare(
    `INSERT INTO test_run (id, session_id, question_id, passed, total, ran_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), input.sessionId, input.questionId, input.passed, input.total, ranAt);
  return { passed: input.passed, total: input.total, ranAt };
}
