-- 001_init —— Candidate Portal 初始 schema
-- 對應 specs/001-candidate-portal/data-model.md

PRAGMA foreign_keys = ON;

-- 面試場次 -------------------------------------------------------------------
CREATE TABLE interview_session (
  id             TEXT PRIMARY KEY,
  candidate_name TEXT    NOT NULL,
  position_title TEXT    NOT NULL,
  duration_sec   INTEGER NOT NULL CHECK (duration_sec > 0),
  started_at     TEXT,
  -- deadline_at MUST 由伺服端計算，MUST NOT 接受用戶端傳入（data-model 驗證規則）
  deadline_at    TEXT,
  status         TEXT    NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started', 'in_progress', 'submitted', 'expired_submitted')),
  submitted_at   TEXT,
  guidance_mode  TEXT    NOT NULL DEFAULT 'light' CHECK (guidance_mode IN ('light', 'deep')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  -- predefined_tests 的內容 MUST NOT 出現在任何回應中（contracts/http-api.md）
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
  -- 每次保存遞增；保存 MUST 拒絕小於現有值的 revision（防止離線補送覆蓋較新內容）
  revision    INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (session_id, question_id)
);

-- 對話訊息 -------------------------------------------------------------------
CREATE TABLE chat_message (
  id                  TEXT    PRIMARY KEY,
  session_id          TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  question_id         TEXT    NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
  role                TEXT    NOT NULL CHECK (role IN ('candidate', 'assistant', 'system')),
  content             TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  attached_code       TEXT,
  guidance_mode       TEXT    CHECK (guidance_mode IS NULL OR guidance_mode IN ('light', 'deep')),
  -- 後處理層是否攔截並改寫過此則回覆（憲章原則 I）
  guardrail_triggered INTEGER NOT NULL DEFAULT 0 CHECK (guardrail_triggered IN (0, 1)),
  source              TEXT    CHECK (
                        source IS NULL
                        OR source IN ('typed', 'quick_prompt', 'question_hint', 'code_review')
                      )
);

CREATE INDEX idx_chat_message_session ON chat_message (session_id, created_at);

-- 環境事件 -------------------------------------------------------------------
-- MUST 僅記錄客觀事實，MUST NOT 含任何判定欄位（FR-026）
CREATE TABLE environment_event (
  id          TEXT    PRIMARY KEY,
  session_id  TEXT    NOT NULL REFERENCES interview_session (id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK (type IN ('window_blur', 'tab_hidden')),
  started_at  TEXT    NOT NULL,
  -- durationMs < 1000 的事件 MUST NOT 記錄（濾除焦點抖動）
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
