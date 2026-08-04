import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * 錯誤碼與 HTTP 映射 —— 見 contracts/http-api.md「錯誤格式（全端點共用）」。
 *
 * `message` MUST 為可直接呈現給應試者的中文說明（FR-031、FR-014）。
 */
export const ERROR_CODES = {
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_NOT_STARTED: 'SESSION_NOT_STARTED',
  SESSION_SUBMITTED: 'SESSION_SUBMITTED',
  REVISION_STALE: 'REVISION_STALE',
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const ERROR_HTTP_STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  TOKEN_INVALID: 404,
  TOKEN_EXPIRED: 410,
  SESSION_NOT_STARTED: 409,
  SESSION_SUBMITTED: 409,
  REVISION_STALE: 409,
  CONTENT_TOO_LARGE: 413,
  AI_UNAVAILABLE: 503,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  TOKEN_INVALID: '這個邀請連結不存在，請向面試安排人員確認連結是否正確。',
  TOKEN_EXPIRED: '這個邀請連結已經逾期，無法再進入此場次。',
  SESSION_NOT_STARTED: '此場次尚未開始，請於約定時間再進入。',
  SESSION_SUBMITTED: '此場次已提交，無法再修改作答。',
  REVISION_STALE: '偵測到較新的草稿版本，已為你保留最新內容。',
  CONTENT_TOO_LARGE: '作答內容超過 256 KB 上限，請精簡後再儲存。',
  AI_UNAVAILABLE: 'AI 助教目前無法回應，你的作答內容不受影響，稍後可再試一次。',
  UNAUTHORIZED: '你的作答連線已失效，請重新開啟邀請連結。',
  NOT_FOUND: '找不到指定的資料。',
  BAD_REQUEST: '請求格式不正確。',
};

/** 額外附加於錯誤回應的欄位，例如 `REVISION_STALE` 需回傳伺服端現值供前端修復。 */
export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, options?: { message?: string; details?: ErrorDetails }) {
    super(options?.message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_HTTP_STATUS[code];
    this.details = options?.details;
  }

  toResponseBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function errorMessageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function httpStatusFor(code: ErrorCode): ContentfulStatusCode {
  return ERROR_HTTP_STATUS[code];
}

/** 未預期的例外一律轉為 500，且 MUST NOT 將內部細節洩漏給應試者。 */
export function toErrorResponse(err: unknown): {
  status: ContentfulStatusCode;
  body: { error: { code: string; message: string; details?: ErrorDetails } };
} {
  if (err instanceof AppError) {
    return { status: err.status, body: err.toResponseBody() };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: '系統發生非預期錯誤，你的作答內容已保留，請稍後再試。',
      },
    },
  };
}
