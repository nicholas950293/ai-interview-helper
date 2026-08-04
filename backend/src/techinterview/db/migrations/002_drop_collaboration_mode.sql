-- 移除協作模式（2026-08-05）
--
-- 「實作／討論」兩種模式是圍欄時代「輕度引導／深入討論」的遺留物。憲章 v3.0.0
-- 反轉原則 I 之後，兩者僅剩「要不要輸出可套用的區塊」這一項差異——而那件事
-- 本來就該由提問的意圖決定，改由系統提示承擔，不需要一個持久化的場次設定。
--
-- 兩個欄位一併移除：
--   interview_session.collaboration_mode —— 場次層級的偏好，已無消費者
--   chat_message.collaboration_mode      —— 訊息送出時的模式，之後恆為 NULL
--
-- 協作歷程的留存不受影響：對話內容、程式碼區塊與 code_change 的來源歸屬
-- 都在別的欄位，憲章原則 I 的可評估性完全保留。

ALTER TABLE interview_session DROP COLUMN collaboration_mode;
ALTER TABLE chat_message DROP COLUMN collaboration_mode;
