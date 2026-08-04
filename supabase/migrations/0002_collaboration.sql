-- 0002_collaboration —— 對話、程式碼區塊、變更歸屬（T015）
--
-- **本檔的 CHECK 約束是本平台評估效力的基礎**（憲章原則 I、SC-010）。
-- 應試者自行輸入與套用 AI 產出 MUST NOT 混為一談——這件事在資料庫層強制，
-- 不倚賴應用層自律：寫錯的那一筆根本進不去。

-- 對話訊息 -------------------------------------------------------------------
create table chat_message (
  id            text        primary key,
  -- seq 為單調遞增的顯示順序。MUST NOT 以 created_at 排序：
  -- 同一毫秒插入的提問與回覆無法靠時間戳分出先後。
  seq           integer     not null,
  session_id    text        not null references interview_session (id) on delete cascade,
  question_id   text        not null references question (id) on delete restrict,
  role          text        not null check (role in ('candidate', 'assistant', 'system')),
  -- AI 的完整輸出，MUST NOT 裁切或改寫（憲章原則 I）
  content       text        not null,
  created_at    timestamptz not null,
  attached_code text,
  -- 留存供應商與模型：評分時需知道應試者是在哪個模型上完成的
  provider      text,
  model         text,
  source        text check (
                  source is null
                  or source in ('typed', 'quick_prompt', 'question_hint', 'code_review')
                ),
  unique (session_id, seq)
);

create index idx_chat_message_session on chat_message (session_id, seq);

-- 回覆中的程式碼區塊 ---------------------------------------------------------
-- 由後端於串流結束後對完整回覆解析產生（research R-013）。
create table chat_code_block (
  id          text    primary key,
  message_id  text    not null references chat_message (id) on delete cascade,
  block_index integer not null check (block_index >= 0),
  language    text,
  -- MUST 與 AI 輸出的該區塊逐字相同（SC-004）
  content     text    not null,
  unique (message_id, block_index)
);

-- 程式碼變更 -----------------------------------------------------------------
create table code_change (
  id              text        primary key,
  seq             integer     not null,
  session_id      text        not null references interview_session (id) on delete cascade,
  question_id     text        not null references question (id) on delete restrict,
  source          text        not null check (source in ('candidate', 'ai')),
  content         text        not null,
  revision        integer     not null,
  created_at      timestamptz not null,
  chat_message_id text        references chat_message (id) on delete set null,
  block_index     integer,

  -- 讓「混為一談」在資料庫層就不可能發生（憲章原則 I）：
  -- source='ai' 必有來源訊息與區塊；'candidate' 兩者必為 null。
  constraint code_change_attribution_consistent check (
    (source = 'ai'        and chat_message_id is not null and block_index is not null)
    or
    (source = 'candidate' and chat_message_id is null     and block_index is null)
  ),

  unique (session_id, seq)
);

create index idx_code_change_session on code_change (session_id, seq);
