import { useSessionStore } from './session';
import { cancelPendingSave, flushPendingSave } from './persistence';
import {
  ApiError,
  applyCodeBlock as apiApplyCodeBlock,
  postChat,
  postChatSystemMessage,
  submitSession as apiSubmitSession,
} from '../services/api';
import { toast } from '../components/ui/toast';
import { openChatStream, type StreamController } from '../services/chat-stream';
import type { ChatSource } from '../types';

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
 *   3. POST /api/chat/system —— 於 Feed 記錄切換，使對話歷程可追溯到當時的題目脈絡
 *   4. StatusBar 與 Chips 訂閱 currentQuestion，自動反映，不需另行通知
 */
export async function switchQuestion(questionId: string): Promise<void> {
  const store = useSessionStore.getState();
  const fromQuestionId = store.currentQuestionId;
  if (questionId === fromQuestionId) return;

  await flushPendingSave();
  useSessionStore.getState().setCurrentQuestion(questionId);

  // 系統訊息失敗不該擋住切題——應試者已經在新題目上了。
  try {
    const { message } = await postChatSystemMessage({ fromQuestionId, toQuestionId: questionId });
    useSessionStore.getState().appendChatMessage(message);
  } catch {
    useSessionStore.getState().appendChatMessage({
      id: `local-switch-${Date.now()}`,
      questionId,
      role: 'system',
      content: '已切換題目。接下來的討論會以這一題為準。',
      createdAt: new Date().toISOString(),
      attachedCode: null,
    });
  }
}

/**
 * 「詢問 AI 題目重點」（ui-contracts A-02）。
 *
 * questionId 由 `sendChat` 從 store 讀取——按鈕不傳參，
 * 因此不可能送出過期的題目（憲章原則 II）。
 */
export const QUESTION_HINT_PROMPT = '請簡要說明這道題目的核心評分要點。';

export function askQuestionHint(): Promise<void> {
  return sendChat({ content: QUESTION_HINT_PROMPT, source: 'question_hint' });
}

/** 「傳送至 AI 側邊欄」（ui-contracts A-03）—— attachCode 會先 flush 待保存的草稿。 */
export const CODE_REVIEW_PROMPT =
  '請檢查我目前的程式碼有哪些 Corner Case 沒處理到，以及可能的潛在缺陷。不要給我修好的版本，指出方向就好。';

export function sendCodeForReview(): Promise<void> {
  return sendChat({ content: CODE_REVIEW_PROMPT, attachCode: true, source: 'code_review' });
}

// --- 套用 AI 產出 -----------------------------------------------------------

export function blockKeyOf(messageId: string, blockIndex: number): string {
  return `${messageId}:${blockIndex}`;
}

/**
 * 套用某個程式碼區塊至編輯器（ui-contracts A-05）。
 *
 *   1. setApplyingBlock() —— 該按鈕轉忙碌，擋掉重複點擊
 *   2. POST /api/answers/{currentQuestionId}/apply —— 伺服端逐字寫入並記為 source='ai'
 *   3. cancelPendingSave() —— 丟棄排程中的草稿保存，否則它會用套用前的內容覆蓋回去
 *   4. applyAiContent() —— 以伺服端回傳的 content 更新 store，編輯器隨之同步
 *   5. 失敗時 MUST NOT 改動編輯器內容
 *
 * 步驟 3 先於 4：兩者之間若插入計時器回呼，被送出的仍是舊草稿。
 * questionId 由 store 讀取而非由呼叫端傳入（憲章原則 II）——按鈕上的區塊
 * 可能來自更早的題目，但套用的對象永遠是「現在這一題」。
 */
export async function applyCodeBlock(messageId: string, blockIndex: number): Promise<void> {
  const store = useSessionStore.getState();
  const questionId = store.currentQuestionId;
  if (!questionId || store.applyingBlockKey !== null) return;

  useSessionStore.getState().setApplyingBlock(blockKeyOf(messageId, blockIndex));

  try {
    const result = await apiApplyCodeBlock({ questionId, messageId, blockIndex });
    cancelPendingSave(questionId);
    useSessionStore.getState().applyAiContent(questionId, result);
  } catch (err) {
    toast({
      tone: 'warning',
      title: '套用失敗',
      description:
        err instanceof ApiError
          ? err.message
          : '無法套用這段程式碼，你目前的作答內容沒有被改動，稍後可再試一次。',
    });
  } finally {
    useSessionStore.getState().setApplyingBlock(null);
  }
}

// --- 提交 -------------------------------------------------------------------

/** 提交失敗時的重試間隔；持續重試直到成功（FR-023：MUST NOT 丟棄內容）。 */
const SUBMIT_RETRY_BASE_MS = 2000;
const SUBMIT_RETRY_MAX_MS = 15_000;

export interface SubmitOptions {
  /** 由計時歸零觸發；會先中止進行中的串流並鎖定輸入。 */
  forced?: boolean;
  onError?: (message: string) => void;
  onSuccess?: () => void;
}

let submitting = false;

/**
 * 提交全卷。
 *
 * 失敗時持續退避重試，作答內容一律保留於 store 與伺服端（FR-023）。
 * 不傳送任何作答內容——伺服端取每題最後保存的草稿（FR-022）。
 */
export async function submitSession(options: SubmitOptions = {}): Promise<void> {
  if (submitting) return;
  submitting = true;

  if (options.forced) {
    // 時間歸零當下 AI 可能正在回覆：回覆須中止，且不影響強制提交（Edge Case）
    abortActiveStream();
  }

  let attempt = 0;

  const attemptSubmit = async (): Promise<void> => {
    try {
      const result = await apiSubmitSession();
      useSessionStore.getState().setSessionStatus(result.status);
      submitting = false;
      options.onSuccess?.();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : '提交失敗，你的作答內容已保留，系統會持續重試。';

      // 場次已是終態：提交其實已經完成，不需要再重試。
      if (err instanceof ApiError && err.code === 'SESSION_SUBMITTED') {
        useSessionStore.getState().setSessionStatus('submitted');
        submitting = false;
        options.onSuccess?.();
        return;
      }

      options.onError?.(message);

      attempt += 1;
      const delay = Math.min(SUBMIT_RETRY_BASE_MS * 2 ** (attempt - 1), SUBMIT_RETRY_MAX_MS);
      setTimeout(() => void attemptSubmit(), delay);
    }
  };

  await attemptSubmit();
}

/** 測試用：重設提交中的旗標。 */
export function resetSubmitState(): void {
  submitting = false;
}

// --- AI 對話 ----------------------------------------------------------------

let activeStream: StreamController | null = null;

/** 中止進行中的串流（時間歸零、場次結束）。 */
export function abortActiveStream(): void {
  activeStream?.abort();
  activeStream = null;
  useSessionStore.getState().setStreaming({ active: false });
}

export interface SendChatOptions {
  content: string;
  attachCode?: boolean;
  source?: ChatSource;
}

/**
 * 送出提問並接收串流回覆。
 *
 * Context 一律從 store 讀取（憲章原則 II）——呼叫端只傳提問內容，
 * 不傳 questionId，避免面板各自持有可能過期的快照。
 */
export async function sendChat({
  content,
  attachCode = false,
  source = 'typed',
}: SendChatOptions): Promise<void> {
  const store = useSessionStore.getState();
  const questionId = store.currentQuestionId;
  if (!questionId || store.streaming.active) return;

  // 附帶程式碼前 MUST 先 flush，否則伺服端取到的是舊草稿（ui-contracts A-03）
  if (attachCode) {
    await flushPendingSave();

    if (useSessionStore.getState().connectivity === 'offline') {
      useSessionStore.getState().appendChatMessage({
        id: `local-offline-${Date.now()}`,
        questionId,
        role: 'system',
        content: '目前離線，程式碼尚未同步至伺服端，因此沒有送出。恢復連線後可再試一次。',
        createdAt: new Date().toISOString(),
        attachedCode: null,
      });
      return;
    }
  }

  const attachedCode = attachCode
    ? (useSessionStore.getState().answers[questionId]?.content ?? '')
    : null;

  // 樂觀呈現：提問先出現在 Feed，不等伺服端回應
  const localId = `local-${Date.now()}`;
  useSessionStore.getState().appendChatMessage({
    id: localId,
    questionId,
    role: 'candidate',
    content,
    createdAt: new Date().toISOString(),
    attachedCode,
  });

  let streamId: string;
  let messageId: string;

  try {
    const result = await postChat({ questionId, content, attachCode, source });
    streamId = result.streamId;
    messageId = result.messageId;
  } catch (err) {
    useSessionStore.getState().appendChatMessage({
      id: `local-error-${Date.now()}`,
      questionId,
      role: 'system',
      content:
        err instanceof ApiError
          ? err.message
          : 'AI 目前無法回應，你的作答內容不受影響，稍後可再試一次。',
      createdAt: new Date().toISOString(),
      attachedCode: null,
    });
    return;
  }

  useSessionStore.getState().appendChatMessage({
    id: messageId,
    questionId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    attachedCode: null,
    pending: true,
  });
  useSessionStore.getState().setStreaming({ active: true, messageId });

  activeStream = openChatStream(streamId, {
    onToken: (text) => useSessionStore.getState().appendStreamToken(messageId, text),
    onBlocks: (codeBlocks) =>
      useSessionStore.getState().replaceChatMessage(messageId, { codeBlocks }),
    onDone: () => {
      useSessionStore.getState().replaceChatMessage(messageId, { pending: false });
      useSessionStore.getState().setStreaming({ active: false });
      activeStream = null;
    },
    onError: (payload) => {
      useSessionStore.getState().replaceChatMessage(messageId, { pending: false });
      useSessionStore.getState().setStreaming({ active: false });
      activeStream = null;
      useSessionStore.getState().appendChatMessage({
        id: `local-error-${Date.now()}`,
        questionId,
        role: 'system',
        content: payload.message,
        createdAt: new Date().toISOString(),
        attachedCode: null,
      });
    },
  });
}
