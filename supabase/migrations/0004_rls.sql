-- 0004_rls —— deny-all 資料列安全性（T017，research R-004）
--
-- 本平台**沒有**終端使用者直連資料庫的情境：應試者的身分由後端的 session cookie
-- 認定，所有存取都經過 FastAPI。因此 PostgREST 那一面（anon / authenticated）
-- 應該完全打不開——一行都不該讀得到。
--
-- 為什麼這件事重要：anon key 依設計是公開的（會出現在瀏覽器裡）。若沒有
-- deny-all，任何拿到 anon key 的人都能直接讀走面試題目、predefined_tests
-- 與所有應試者的作答——題目一旦外流，整批場次的評分就失去意義。
--
-- **後端不經 PostgREST**：它以 psycopg 直連 Postgres（`postgres` 角色，
-- 具 bypassrls），因此不受這些政策影響。service_role 同樣未被授予任何資料表
-- 權限——本架構沒有任何元件需要它，少一條路就少一個外洩管道。
-- 這比 research R-004 原本設想的「僅 service role 可存取」更嚴格：
-- 整個 Data API 表面是關的，而不是只擋住 anon。
--
-- 註：Supabase 較新版本預設就不把新資料表自動曝露給 Data API 角色
-- （config.toml 的 auto_expose_new_tables，2026-10-30 後成為唯一行為）。
-- 本檔的 revoke 因此多半是重複的——但**刻意保留**：預設值會變，
-- 寫死在遷移裡的意圖不會。
--
-- 刻意**不**使用 `force row level security`：那會連資料表擁有者（postgres）
-- 都一併擋下，而遷移與後端的直連正是以該身分執行。

do $$
declare
  t text;
begin
  foreach t in array array[
    'interview_session',
    'invite_token',
    'question',
    'session_question',
    'answer',
    'chat_message',
    'chat_code_block',
    'code_change',
    'environment_event',
    'test_run'
  ]
  loop
    -- 啟用 RLS 且不建立任何 policy = 對 anon / authenticated 全面拒絕
    execute format('alter table public.%I enable row level security', t);

    -- 縱深防禦：連資料表權限本身都收回。RLS 若因設定失誤被關掉，
    -- 這一層仍會擋住——兩道都要失守才會外洩。
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- 未來新增的資料表預設也不開放給 anon / authenticated。
-- 沒有這段，下一個建表的人很容易忘記補上而默默開了洞。
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
