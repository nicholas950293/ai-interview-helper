/**
 * 進入失敗與載入失敗的狀態畫面（FR-031 / Edge Case：題目資料載入失敗）。
 *
 * 每一種狀態都有明確說明與可執行的下一步，MUST NOT 呈現空白畫面。
 */
interface ErrorStateCopy {
  title: string;
  hint: string;
  retryable: boolean;
}

const COPY: Record<string, ErrorStateCopy> = {
  TOKEN_INVALID: {
    title: '找不到這個面試場次',
    hint: '邀請連結可能不完整或已被更換。請向面試安排人員索取新的連結。',
    retryable: false,
  },
  TOKEN_EXPIRED: {
    title: '邀請連結已逾期',
    hint: '這個連結的有效期已過，無法再進入場次。請聯絡面試安排人員重新發送。',
    retryable: false,
  },
  SESSION_NOT_STARTED: {
    title: '場次尚未開始',
    hint: '請於約定的面試時間再開啟此連結。提早進入不會縮短你的作答時間。',
    retryable: true,
  },
  SESSION_SUBMITTED: {
    title: '此場次已經提交',
    hint: '作答已送出並完成留存，無法再修改或重新進入。',
    retryable: false,
  },
  NETWORK_OFFLINE: {
    title: '目前無法連線',
    hint: '請檢查網路後再試一次。若你先前已作答，內容都保留在本機，恢復連線後會自動送出。',
    retryable: true,
  },
  UNAUTHORIZED: {
    title: '作答連線已失效',
    hint: '請重新開啟邀請連結以繼續作答。你先前儲存的內容不會遺失。',
    retryable: false,
  },
};

const FALLBACK: ErrorStateCopy = {
  title: '無法進入面試場次',
  hint: '系統發生非預期的問題。請稍後再試，或聯絡面試安排人員。',
  retryable: true,
};

export function LoadErrorScreen({ code, message }: { code: string; message: string }) {
  const copy = COPY[code] ?? FALLBACK;

  return (
    <div className="flex h-full items-center justify-center p-8" role="alert">
      <div className="card max-w-lg p-8">
        <h1 className="text-lg font-semibold text-text-primary">{copy.title}</h1>
        <p className="mt-3 text-text-secondary">{message}</p>
        <p className="mt-2 text-sm text-text-muted">{copy.hint}</p>
        <p className="mt-4 text-xs text-text-muted">
          狀態代碼：<code className="font-mono">{code}</code>
        </p>

        {copy.retryable && (
          <button
            type="button"
            className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm text-text-inverse hover:bg-accent-hover"
            onClick={() => window.location.reload()}
          >
            重新嘗試
          </button>
        )}
      </div>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div
      className="flex h-full items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="text-text-secondary">正在載入面試場次…</p>
    </div>
  );
}

/** 同一場次已在其他分頁開啟（Edge Case）。 */
export function DuplicateTabScreen() {
  return (
    <div className="flex h-full items-center justify-center p-8" role="alert">
      <div className="card max-w-lg p-8">
        <h1 className="text-lg font-semibold text-text-primary">此場次已在其他分頁開啟</h1>
        <p className="mt-3 text-text-secondary">
          為避免兩個分頁的草稿互相覆蓋，這個分頁不會載入作答介面。 請回到先前開啟的分頁繼續作答。
        </p>
        <p className="mt-2 text-sm text-text-muted">若你已經關閉那個分頁，重新整理本頁即可接手。</p>
        <button
          type="button"
          className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm text-text-inverse hover:bg-accent-hover"
          onClick={() => window.location.reload()}
        >
          我已關閉另一個分頁，重新載入
        </button>
      </div>
    </div>
  );
}
