-- 0001_core —— 場次、邀請、題目、作答（T014）
--
-- 對應 specs/001-candidate-portal/data-model.md。
-- 由 backend/src/techinterview/db/migrations/001_init.sql（SQLite）移植而來，
-- 兩處刻意的差異：
--
--   1. 時間欄位改為 timestamptz（data-model.md 的宣告）。SQLite 版存的是
--      ISO-8601 字串，Postgres 有真正的時間型別就沒有理由不用。查詢層以
--      to_char() 在 SQL 內格式化回 API 契約要求的字串，Python 端仍只見字串。
--   2. 主鍵維持 text 而非 data-model.md 寫的 uuid。seed 與 e2e 依賴
--      `q-rate-limiter`、`sess-demo` 這類可讀 id——那是刻意的設計（出錯時看
--      日誌就知道是哪一題），改為 uuid 只會讓除錯變難。data-model.md 已同步更正。
--
-- 協作模式的兩個欄位不在此出現：已於 2026-08-05 移除（research R-015）。

-- 面試場次 -------------------------------------------------------------------
create table interview_session (
  id             text primary key,
  candidate_name text        not null,
  position_title text        not null,
  duration_sec   integer     not null check (duration_sec > 0),
  started_at     timestamptz,
  -- deadline_at MUST 由伺服端計算，MUST NOT 接受用戶端傳入
  deadline_at    timestamptz,
  status         text        not null default 'not_started'
                 check (status in ('not_started', 'in_progress', 'submitted', 'expired_submitted')),
  submitted_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- 邀請連結 -------------------------------------------------------------------
create table invite_token (
  token         text primary key,
  session_id    text        not null unique references interview_session (id) on delete cascade,
  status        text        not null default 'pending'
                check (status in ('pending', 'active', 'consumed', 'expired')),
  expires_at    timestamptz not null,
  first_used_at timestamptz
);

-- 題目 -----------------------------------------------------------------------
-- *_json 欄位改用 jsonb：Postgres 原生型別，寫入時就會擋掉格式錯誤的內容，
-- 不必等到 Python 端 json.loads 才炸。
create table question (
  id                     text    primary key,
  title                  text    not null,
  difficulty             text    not null check (difficulty in ('easy', 'medium', 'hard')),
  points                 integer not null check (points > 0),
  description            text    not null,
  examples               jsonb   not null default '[]'::jsonb,
  complexity_requirement text    not null default '',
  grading_focus          jsonb   not null default '[]'::jsonb,
  starter_code           jsonb   not null default '{}'::jsonb,
  -- predefined_tests 的內容 MUST NOT 出現在任何回應中（FR-030）
  predefined_tests       jsonb   not null default '[]'::jsonb,
  quick_prompts          jsonb   not null default '[]'::jsonb
);

-- 場次題目 -------------------------------------------------------------------
create table session_question (
  session_id  text    not null references interview_session (id) on delete cascade,
  question_id text    not null references question (id) on delete restrict,
  "order"     integer not null check ("order" >= 1),
  primary key (session_id, question_id)
);

create index idx_session_question_order on session_question (session_id, "order");

-- 作答 -----------------------------------------------------------------------
create table answer (
  session_id  text        not null references interview_session (id) on delete cascade,
  question_id text        not null references question (id) on delete restrict,
  language    text        not null check (language in ('javascript', 'typescript', 'python', 'go')),
  content     text        not null default '',
  saved_at    timestamptz not null,
  revision    integer     not null default 0 check (revision >= 0),
  primary key (session_id, question_id)
);
