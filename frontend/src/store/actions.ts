import { useSessionStore } from './session';
import { flushPendingSave } from './persistence';

/**
 * 跨模組的動作編排。
 *
 * 放在獨立模組而非 session.ts：`persistence` 依賴 store，store 若反過來
 * 依賴 persistence 會形成模組載入期的循環（實測會踩到 TDZ）。
 * 這裡是唯一同時依賴兩者的地方，方向維持單向。
 */

/**
 * 切換題目（contracts/ui-contracts.md A-01）。
 *
 *   1. flushPendingSave() —— 未保存的變更先落地，否則切走就遺失
 *   2. setCurrentQuestion() —— 三個面板同時看到新題目；尚無作答的題目載入 starter code
 *
 * 步驟 3（於對話 Feed 插入系統訊息）由 US3 的 T069 接上。
 */
export async function switchQuestion(questionId: string): Promise<void> {
  const store = useSessionStore.getState();
  if (questionId === store.currentQuestionId) return;

  await flushPendingSave();
  useSessionStore.getState().setCurrentQuestion(questionId);
}
