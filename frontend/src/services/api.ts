import type {
  ChatSource,
  Language,
  SessionPayload,
  Session,
  ChatMessage,
  SessionStatus,
} from '../types';

const BASE = '/api';

/** 對應 contracts/http-api.md「錯誤格式（全端點共用）」。 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** 網路不可用與伺服端錯誤的區分：前者可重試，後者需呈現說明。 */
  get isOffline(): boolean {
    return this.code === 'NETWORK_OFFLINE';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError(
      'NETWORK_OFFLINE',
      '目前無法連線，內容已暫存於本機，恢復連線後會自動送出。',
      0
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (
      body as { error?: { code: string; message: string; details?: Record<string, unknown> } }
    )?.error;
    throw new ApiError(
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? '系統發生非預期錯誤，請稍後再試。',
      res.status,
      err?.details
    );
  }

  return body as T;
}

// --- 場次 -------------------------------------------------------------------

export function redeemToken(token: string): Promise<{ session: Session; serverTime: string }> {
  return request('/session/redeem', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function fetchSession(): Promise<SessionPayload> {
  return request('/session');
}

// --- 作答 -------------------------------------------------------------------

export interface SaveAnswerInput {
  questionId: string;
  language: Language;
  content: string;
  revision: number;
}

export function saveAnswer(input: SaveAnswerInput): Promise<{ savedAt: string; revision: number }> {
  const { questionId, ...body } = input;
  return request(`/answers/${encodeURIComponent(questionId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * 套用 AI 產出的程式碼區塊（ui-contracts A-05 步驟 2）。
 *
 * 為什麼要往返後端而不是前端直接塞進編輯器：走一般的保存路徑，這次變更就會與
 * 應試者自行輸入無法區分——正是憲章原則 I 禁止的「混為一談」。
 * 回應的 `content` 是資料庫裡那一份，前端一律以它為準寫入編輯器。
 */
export function applyCodeBlock(input: {
  questionId: string;
  messageId: string;
  blockIndex: number;
}): Promise<{ content: string; savedAt: string; revision: number }> {
  const { questionId, ...body } = input;
  return request(`/answers/${encodeURIComponent(questionId)}/apply`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** 離線補送：一次帶多筆，伺服端依 revision 排序套用。 */
export function saveAnswersBatch(
  inputs: SaveAnswerInput[]
): Promise<{ saved: { questionId: string; savedAt: string; revision: number }[] }> {
  return request('/answers', {
    method: 'PUT',
    body: JSON.stringify(inputs),
  });
}

export function runTests(
  questionId: string
): Promise<{ passed: number; total: number; ranAt: string }> {
  return request(`/tests/${encodeURIComponent(questionId)}`, { method: 'POST' });
}

// --- 計時與提交 -------------------------------------------------------------

export function fetchTime(): Promise<{
  serverTime: string;
  deadlineAt: string | null;
  status: SessionStatus;
}> {
  return request('/time');
}

export function submitSession(): Promise<{ submittedAt: string; status: SessionStatus }> {
  return request('/submit', { method: 'POST' });
}

// --- AI ---------------------------------------------------------------------

export interface ChatRequestInput {
  questionId: string;
  content: string;
  attachCode: boolean;
  source: ChatSource;
}

export function postChat(
  input: ChatRequestInput
): Promise<{ streamId: string; messageId: string }> {
  return request('/chat', { method: 'POST', body: JSON.stringify(input) });
}

export function postChatSystemMessage(input: {
  fromQuestionId: string;
  toQuestionId: string;
}): Promise<{ message: ChatMessage }> {
  return request('/chat/system', { method: 'POST', body: JSON.stringify(input) });
}

// --- 環境事件 ---------------------------------------------------------------

export function postEnvironmentEvents(
  events: { type: 'window_blur' | 'tab_hidden'; startedAt: string; durationMs: number }[]
): Promise<{ accepted: number }> {
  return request('/events', { method: 'POST', body: JSON.stringify(events) });
}
