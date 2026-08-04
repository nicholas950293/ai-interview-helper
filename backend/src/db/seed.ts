import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDb, type Db } from './client.js';
import { runMigrations } from './migrate.js';
import type { Example, Language, TestCase } from '../lib/schemas.js';

interface SeedQuestion {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  points: number;
  description: string;
  examples: Example[];
  complexityRequirement: string;
  gradingFocus: string[];
  starterCode: Record<Language, string>;
  predefinedTests: TestCase[];
  quickPrompts: string[];
}

const QUESTIONS: SeedQuestion[] = [
  {
    id: 'q-rate-limiter',
    title: 'API 限流器',
    difficulty: 'medium',
    points: 40,
    description: [
      '設計一個 API 限流器，限制每個使用者在滑動時間窗內可發出的請求數。',
      '',
      '**功能規格**',
      '',
      '- `allow(userId, timestampMs)` 回傳布林值，表示該請求是否放行。',
      '- 每個使用者在任意連續 `windowMs` 毫秒內，最多允許 `maxRequests` 次請求。',
      '- 時間窗為滑動窗（sliding window），非固定區間。',
      '- 不同使用者之間互不影響。',
    ].join('\n'),
    examples: [
      {
        input:
          'limiter = RateLimiter(maxRequests=3, windowMs=1000)\nallow("u1", 0), allow("u1", 100), allow("u1", 200), allow("u1", 300)',
        output: 'true, true, true, false',
        note: '第 4 次請求落在同一個 1000ms 窗內，被拒絕。',
      },
      {
        input: 'allow("u1", 1100)',
        output: 'true',
        note: '時間推進後，最早的請求已滑出窗外。',
      },
    ],
    complexityRequirement: '每次 allow 呼叫的均攤時間複雜度 O(1)，空間 O(使用者數 × maxRequests)。',
    gradingFocus: [
      '滑動窗與固定窗的差異是否正確處理',
      '過期記錄的清理是否會造成記憶體無限成長',
      '邊界：時間戳相同、maxRequests 為 0、使用者首次請求',
      '併發語意的說明（本題不要求執行緒安全，但需說明取捨）',
    ],
    starterCode: {
      javascript: [
        'class RateLimiter {',
        '  constructor(maxRequests, windowMs) {',
        '    this.maxRequests = maxRequests;',
        '    this.windowMs = windowMs;',
        '    // 在此設計你的資料結構',
        '  }',
        '',
        '  allow(userId, timestampMs) {',
        '    // 在此作答',
        '  }',
        '}',
        '',
      ].join('\n'),
      typescript: [
        'class RateLimiter {',
        '  constructor(',
        '    private readonly maxRequests: number,',
        '    private readonly windowMs: number',
        '  ) {',
        '    // 在此設計你的資料結構',
        '  }',
        '',
        '  allow(userId: string, timestampMs: number): boolean {',
        '    // 在此作答',
        '  }',
        '}',
        '',
      ].join('\n'),
      python: [
        'class RateLimiter:',
        '    def __init__(self, max_requests: int, window_ms: int) -> None:',
        '        self.max_requests = max_requests',
        '        self.window_ms = window_ms',
        '        # 在此設計你的資料結構',
        '',
        '    def allow(self, user_id: str, timestamp_ms: int) -> bool:',
        '        # 在此作答',
        '        ...',
        '',
      ].join('\n'),
      go: [
        'type RateLimiter struct {',
        '\tmaxRequests int',
        '\twindowMs    int64',
        '\t// 在此設計你的資料結構',
        '}',
        '',
        'func NewRateLimiter(maxRequests int, windowMs int64) *RateLimiter {',
        '\treturn &RateLimiter{maxRequests: maxRequests, windowMs: windowMs}',
        '}',
        '',
        'func (r *RateLimiter) Allow(userID string, timestampMs int64) bool {',
        '\t// 在此作答',
        '\treturn false',
        '}',
        '',
      ].join('\n'),
    },
    predefinedTests: [
      { name: '窗內未超額的請求全數放行', expectedPass: true },
      { name: '窗內超額的請求被拒絕', expectedPass: true },
      { name: '時間推進後舊記錄滑出窗外', expectedPass: true },
      { name: '不同使用者互不影響', expectedPass: true },
      { name: '邊界：maxRequests 為 0 時一律拒絕', expectedPass: false },
    ],
    quickPrompts: ['檢查 Corner Cases', '分析時間複雜度', '這個資料結構選得好嗎？'],
  },
  {
    id: 'q-lru-cache',
    title: 'LRU 快取',
    difficulty: 'medium',
    points: 30,
    description: [
      '實作一個固定容量的 LRU（Least Recently Used）快取。',
      '',
      '**功能規格**',
      '',
      '- `get(key)` 回傳對應值；不存在時回傳 `-1`（或該語言的 null 慣例）。',
      '- `put(key, value)` 寫入鍵值；容量已滿時淘汰最久未使用的項目。',
      '- `get` 與 `put` 都算一次「使用」，會把該鍵移到最近使用端。',
    ].join('\n'),
    examples: [
      {
        input: 'cache = LRUCache(2)\nput(1,1), put(2,2), get(1), put(3,3), get(2)',
        output: '1, -1',
        note: 'put(3,3) 時容量已滿，最久未使用的 key 2 被淘汰。',
      },
    ],
    complexityRequirement: 'get 與 put 皆需 O(1) 時間複雜度。',
    gradingFocus: [
      '是否達成 O(1) —— 只用陣列掃描不符要求',
      '雙向鏈結串列與雜湊表的搭配是否正確',
      '邊界：容量為 1、重複 put 同一個 key、get 不存在的 key',
      '節點移除與插入時的指標處理是否有遺漏',
    ],
    starterCode: {
      javascript: [
        'class LRUCache {',
        '  constructor(capacity) {',
        '    this.capacity = capacity;',
        '    // 在此設計你的資料結構',
        '  }',
        '',
        '  get(key) {',
        '    // 在此作答',
        '  }',
        '',
        '  put(key, value) {',
        '    // 在此作答',
        '  }',
        '}',
        '',
      ].join('\n'),
      typescript: [
        'class LRUCache {',
        '  constructor(private readonly capacity: number) {',
        '    // 在此設計你的資料結構',
        '  }',
        '',
        '  get(key: number): number {',
        '    // 在此作答',
        '  }',
        '',
        '  put(key: number, value: number): void {',
        '    // 在此作答',
        '  }',
        '}',
        '',
      ].join('\n'),
      python: [
        'class LRUCache:',
        '    def __init__(self, capacity: int) -> None:',
        '        self.capacity = capacity',
        '        # 在此設計你的資料結構',
        '',
        '    def get(self, key: int) -> int:',
        '        # 在此作答',
        '        ...',
        '',
        '    def put(self, key: int, value: int) -> None:',
        '        # 在此作答',
        '        ...',
        '',
      ].join('\n'),
      go: [
        'type LRUCache struct {',
        '\tcapacity int',
        '\t// 在此設計你的資料結構',
        '}',
        '',
        'func NewLRUCache(capacity int) *LRUCache {',
        '\treturn &LRUCache{capacity: capacity}',
        '}',
        '',
        'func (c *LRUCache) Get(key int) int {',
        '\t// 在此作答',
        '\treturn -1',
        '}',
        '',
        'func (c *LRUCache) Put(key int, value int) {',
        '\t// 在此作答',
        '}',
        '',
      ].join('\n'),
    },
    predefinedTests: [
      { name: '基本 get / put', expectedPass: true },
      { name: '超過容量時淘汰最久未使用者', expectedPass: true },
      { name: 'get 會更新使用順序', expectedPass: true },
      { name: '重複 put 同一個 key 只更新值', expectedPass: true },
      { name: '邊界：容量為 1', expectedPass: true },
    ],
    quickPrompts: ['檢查 Corner Cases', '如何達成 O(1)？', '這樣寫有記憶體洩漏風險嗎？'],
  },
  {
    id: 'q-message-queue',
    title: '訊息佇列',
    difficulty: 'hard',
    points: 30,
    description: [
      '設計一個支援延遲投遞與至少一次語意的記憶體訊息佇列。',
      '',
      '**功能規格**',
      '',
      '- `publish(topic, payload, delayMs)` 將訊息排入佇列，`delayMs` 後才可被消費。',
      '- `poll(topic, nowMs)` 取出一則到期訊息並標記為處理中，逾時未 ack 需重新可見。',
      '- `ack(messageId)` 確認處理完成，該訊息不再重新投遞。',
    ].join('\n'),
    examples: [
      {
        input: 'publish("t", "a", 1000) 於 t=0\npoll("t", 500)',
        output: 'null',
        note: '延遲時間未到，訊息尚不可見。',
      },
      {
        input: 'poll("t", 1000)',
        output: '{ id, payload: "a" }',
        note: '到期後可被取出。',
      },
    ],
    complexityRequirement: 'poll 需優於 O(n)；建議以優先佇列達成 O(log n)。',
    gradingFocus: [
      '延遲投遞與可見性逾時的資料結構選擇',
      '至少一次語意如何保證（未 ack 的訊息必須重新可見）',
      '邊界：同時到期的多則訊息、ack 不存在的 id、重複 ack',
      '為何不用「掃描全部訊息」的作法',
    ],
    starterCode: {
      javascript: [
        'class MessageQueue {',
        '  constructor() {',
        '    // 在此設計你的資料結構',
        '  }',
        '',
        '  publish(topic, payload, delayMs = 0) {',
        '    // 在此作答，回傳 messageId',
        '  }',
        '',
        '  poll(topic, nowMs) {',
        '    // 在此作答',
        '  }',
        '',
        '  ack(messageId) {',
        '    // 在此作答',
        '  }',
        '}',
        '',
      ].join('\n'),
      typescript: [
        'interface Message {',
        '  id: string;',
        '  payload: string;',
        '}',
        '',
        'class MessageQueue {',
        '  publish(topic: string, payload: string, delayMs = 0): string {',
        '    // 在此作答',
        '  }',
        '',
        '  poll(topic: string, nowMs: number): Message | null {',
        '    // 在此作答',
        '  }',
        '',
        '  ack(messageId: string): void {',
        '    // 在此作答',
        '  }',
        '}',
        '',
      ].join('\n'),
      python: [
        'class MessageQueue:',
        '    def __init__(self) -> None:',
        '        # 在此設計你的資料結構',
        '        ...',
        '',
        '    def publish(self, topic: str, payload: str, delay_ms: int = 0) -> str:',
        '        # 在此作答',
        '        ...',
        '',
        '    def poll(self, topic: str, now_ms: int):',
        '        # 在此作答',
        '        ...',
        '',
        '    def ack(self, message_id: str) -> None:',
        '        # 在此作答',
        '        ...',
        '',
      ].join('\n'),
      go: [
        'type Message struct {',
        '\tID      string',
        '\tPayload string',
        '}',
        '',
        'type MessageQueue struct {',
        '\t// 在此設計你的資料結構',
        '}',
        '',
        'func (q *MessageQueue) Publish(topic string, payload string, delayMs int64) string {',
        '\t// 在此作答',
        '\treturn ""',
        '}',
        '',
        'func (q *MessageQueue) Poll(topic string, nowMs int64) *Message {',
        '\t// 在此作答',
        '\treturn nil',
        '}',
        '',
        'func (q *MessageQueue) Ack(messageID string) {',
        '\t// 在此作答',
        '}',
        '',
      ].join('\n'),
    },
    predefinedTests: [
      { name: '延遲未到的訊息不可見', expectedPass: true },
      { name: '到期訊息可被 poll 取出', expectedPass: true },
      { name: '未 ack 的訊息在可見性逾時後重新投遞', expectedPass: false },
      { name: 'ack 後不再重新投遞', expectedPass: true },
      { name: '不同 topic 互不影響', expectedPass: true },
      { name: '邊界：同時到期的多則訊息依序取出', expectedPass: false },
    ],
    quickPrompts: ['檢查 Corner Cases', '至少一次 vs 最多一次？', '這個資料結構撐得住嗎？'],
  },
];

export interface SeedResult {
  sessionId: string;
  token: string;
  url: string;
}

export function seed(db: Db = getDb()): SeedResult {
  runMigrations(db);

  const sessionId = 'sess-demo';
  // 128-bit 隨機值，URL 安全編碼（R-009）
  const token = randomBytes(16).toString('base64url');
  const durationSec = 90 * 60;
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const apply = db.transaction(() => {
    db.prepare('DELETE FROM invite_token WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM interview_session WHERE id = ?').run(sessionId);

    db.prepare(
      `INSERT INTO interview_session
         (id, candidate_name, position_title, duration_sec, status, guidance_mode)
       VALUES (?, ?, ?, ?, 'not_started', 'light')`
    ).run(sessionId, 'Alex Chen', '資深全端工程師模擬面試', durationSec);

    db.prepare(
      `INSERT INTO invite_token (token, session_id, status, expires_at)
       VALUES (?, ?, 'pending', ?)`
    ).run(token, sessionId, expiresAt);

    const upsertQuestion = db.prepare(
      `INSERT INTO question
         (id, title, difficulty, points, description, examples_json, complexity_requirement,
          grading_focus_json, starter_code_json, predefined_tests_json, quick_prompts_json)
       VALUES (@id, @title, @difficulty, @points, @description, @examples, @complexity,
               @gradingFocus, @starterCode, @predefinedTests, @quickPrompts)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title,
         difficulty = excluded.difficulty,
         points = excluded.points,
         description = excluded.description,
         examples_json = excluded.examples_json,
         complexity_requirement = excluded.complexity_requirement,
         grading_focus_json = excluded.grading_focus_json,
         starter_code_json = excluded.starter_code_json,
         predefined_tests_json = excluded.predefined_tests_json,
         quick_prompts_json = excluded.quick_prompts_json`
    );

    const linkQuestion = db.prepare(
      `INSERT INTO session_question (session_id, question_id, "order") VALUES (?, ?, ?)
       ON CONFLICT (session_id, question_id) DO UPDATE SET "order" = excluded."order"`
    );

    QUESTIONS.forEach((q, index) => {
      upsertQuestion.run({
        id: q.id,
        title: q.title,
        difficulty: q.difficulty,
        points: q.points,
        description: q.description,
        examples: JSON.stringify(q.examples),
        complexity: q.complexityRequirement,
        gradingFocus: JSON.stringify(q.gradingFocus),
        starterCode: JSON.stringify(q.starterCode),
        predefinedTests: JSON.stringify(q.predefinedTests),
        quickPrompts: JSON.stringify(q.quickPrompts),
      });
      linkQuestion.run(sessionId, q.id, index + 1);
    });
  });

  apply();

  return { sessionId, token, url: `http://localhost:5173/s/${token}` };
}

// `npm run db:seed`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = seed();
  console.log('[db] 已建立示範場次：');
  console.log(`  sessionId : ${result.sessionId}`);
  console.log(`  題目      : ${QUESTIONS.map((q) => q.title).join('、')}`);
  console.log(`  邀請連結  : ${result.url}`);
}
