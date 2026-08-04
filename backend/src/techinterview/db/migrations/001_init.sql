-- 001_init —— Candidate Portal 初始 schema（Increment 1，SQLite）
--
-- 對應 specs/001-candidate-portal/data-model.md。
-- 憲章原則 V 要求 Supabase（Postgres），本次為已記錄的落差；
-- 欄位命名與約束刻意與 data-model 的 Postgres 版一致，遷移時只換方言。

PRAGMA foreign_keys = ON;

-- 面試場次 -------------------------------------------------------------------
CREATE TABLE interview_session (
  id                 TEXT PRIMARY KEY,
  candidate_name     TEXT    NOT NULL,
  position_title     TEXT    NOT NULL,
  duration_sec       INTEGER NOT NULL CHECK (duration_sec > 0),
  started_at         TEXT,
  -- deadline_at MUST 由伺服端計算，MUST NOT 接受用戶端傳入
  deadline_at        TEXT,
  status             TEXT    NOT NULL DEFAULT 'not_started'
                     CHECK (status IN ('not_started', 'in_progress', 'submitted', 'expired_submitted')),
  submitted_at       TEXT,
  -- 預設 implement：本平台的評估標的是透過 AI 實作（research R-015）
  collaboration_mode TEXT    NOT NULL DEFAULT 'implement'
                     CHECK (collaboration_mode IN ('discuss', 'implement')),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 邀請連結 -------------------------------------------------------------------
CREATE TABLE invite_token (
  token         TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL UNIQUE REFERENCES interview_session (id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'consumed', 'expired')),
  expires_at    TEXT NOT NULL,
  first_used_at TEXT
);

-- 題目 -----------------------------------------------------------------------
CREATE TABLE question (
  id                     TEXT PRIMARY KEY,
  title                  TEXT    NOT NULL,
  difficulty             TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  points                 INTEGER NOT NULL CHECK (points > 0),
  description            TEXT    NOT NULL,
  examples_json          TEXT    NOT NULL DEFAULT '[]',
  complexity_requirement TEXT    NOT NULL DEFAULT '',
  grading_focus_json     TEXT    NOT NULL DEFAULT '[]',
  starter_code_json      TEXT    NOT NULL DEFAULT '{}',
  -- predefined_tests 的內容 MUST NOT 出現在任何回應中（FR-030）
  predefined_tests_json  TEXT    NOT NULL DEFAULT '[]',
  quick_prompts_json     TEXT    NOT NULL DEFAULT '[]'
);

-- 場次題目 -------------------------------------------------------------------
CREATE TABLE session_question (
  session_id  TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  question_id TEXT    NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
  "order"     INTEGER NOT NULL CHECK ("order" >= 1),
  PRIMARY KEY (session_id, question_id)
);

CREATE INDEX idx_session_question_order ON session_question (session_id, "order");

-- 作答 -----------------------------------------------------------------------
CREATE TABLE answer (
  session_id  TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  question_id TEXT    NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
  language    TEXT    NOT NULL CHECK (language IN ('javascript', 'typescript', 'python', 'go')),
  content     TEXT    NOT NULL DEFAULT '',
  saved_at    TEXT    NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (session_id, question_id)
);

-- 對話訊息 -------------------------------------------------------------------
CREATE TABLE chat_message (
  id                 TEXT    PRIMARY KEY,
  -- seq 為單調遞增的顯示順序。MUST NOT 以 created_at 排序：
  -- 同一毫秒插入的提問與回覆無法靠時間戳分出先後。
  seq                INTEGER NOT NULL,
  session_id         TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  question_id        TEXT    NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
  role               TEXT    NOT NULL CHECK (role IN ('candidate', 'assistant', 'system')),
  -- AI 的完整輸出，MUST NOT 裁切或改寫（憲章原則 I）
  content            TEXT    NOT NULL,
  created_at         TEXT    NOT NULL,
  attached_code      TEXT,
  collaboration_mode TEXT    CHECK (collaboration_mode IS NULL
                                    OR collaboration_mode IN ('discuss', 'implement')),
  -- 留存供應商與模型：評分時需知道應試者是在哪個模型上完成的
  provider           TEXT,
  model              TEXT,
  source             TEXT    CHECK (
                       source IS NULL
                       OR source IN ('typed', 'quick_prompt', 'question_hint', 'code_review')
                     )
);

CREATE INDEX idx_chat_message_session ON chat_message (session_id, seq);

-- 回覆中的程式碼區塊 ---------------------------------------------------------
-- 由後端於串流結束後對完整回覆解析產生（research R-013）。
CREATE TABLE chat_code_block (
  id          TEXT    PRIMARY KEY,
  message_id  TEXT    NOT NULL REFERENCES chat_message (id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL CHECK (block_index >= 0),
  language    TEXT,
  -- MUST 與 AI 輸出的該區塊逐字相同（SC-004）
  content     TEXT    NOT NULL,
  UNIQUE (message_id, block_index)
);

-- 程式碼變更 -----------------------------------------------------------------
-- 本平台評估效力的核心資料（憲章原則 I、SC-010）。
CREATE TABLE code_change (
  id              TEXT    PRIMARY KEY,
  seq             INTEGER NOT NULL,
  session_id      TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  question_id     TEXT    NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
  source          TEXT    NOT NULL CHECK (source IN ('candidate', 'ai')),
  content         TEXT    NOT NULL,
  revision        INTEGER NOT NULL,
  created_at      TEXT    NOT NULL,
  chat_message_id TEXT    REFERENCES chat_message (id) ON DELETE SET NULL,
  block_index     INTEGER,

  -- 讓「混為一談」在資料庫層就不可能發生（憲章原則 I）：
  -- source='ai' 必有來源訊息與區塊；'candidate' 兩者必為 null。
  CHECK (
    (source = 'ai'        AND chat_message_id IS NOT NULL AND block_index IS NOT NULL)
    OR
    (source = 'candidate' AND chat_message_id IS NULL     AND block_index IS NULL)
  )
);

CREATE INDEX idx_code_change_session ON code_change (session_id, seq);

-- 平台外工具事件 -------------------------------------------------------------
-- MUST 僅記錄客觀事實，MUST NOT 含任何判定欄位（FR-026）
CREATE TABLE environment_event (
  id          TEXT    PRIMARY KEY,
  session_id  TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK (type IN ('window_blur', 'tab_hidden')),
  started_at  TEXT    NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 1000)
);

CREATE INDEX idx_environment_event_session ON environment_event (session_id, started_at);

-- 測試結果 -------------------------------------------------------------------
CREATE TABLE test_run (
  id          TEXT    PRIMARY KEY,
  session_id  TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  question_id TEXT    NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
  passed      INTEGER NOT NULL CHECK (passed >= 0),
  total       INTEGER NOT NULL CHECK (total >= 0),
  ran_at      TEXT    NOT NULL
);

CREATE INDEX idx_test_run_session ON test_run (session_id, ran_at);
