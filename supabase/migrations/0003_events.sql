-- 0003_events —— 平台外工具事件與測試結果（T016）

-- 平台外工具事件 -------------------------------------------------------------
-- MUST 僅記錄客觀事實，MUST NOT 含任何判定欄位（FR-026）。
-- schema 沒有「是否作弊」這種欄位，就寫不進去——這是刻意的設計而非疏漏。
create table environment_event (
  id          text        primary key,
  session_id  text        not null references interview_session (id) on delete cascade,
  type        text        not null check (type in ('window_blur', 'tab_hidden')),
  started_at  timestamptz not null,
  -- 短於 1 秒的切換視為焦點抖動，不記錄（FR-025）
  duration_ms integer     not null check (duration_ms >= 1000)
);

create index idx_environment_event_session on environment_event (session_id, started_at);

-- 測試結果 -------------------------------------------------------------------
-- 僅記錄通過數與總數；個別案例的期望值 MUST NOT 外洩（FR-030）。
create table test_run (
  id          text        primary key,
  session_id  text        not null references interview_session (id) on delete cascade,
  question_id text        not null references question (id) on delete restrict,
  passed      integer     not null check (passed >= 0),
  total       integer     not null check (total >= 0),
  ran_at      timestamptz not null,
  check (passed <= total)
);

create index idx_test_run_session on test_run (session_id, ran_at);
