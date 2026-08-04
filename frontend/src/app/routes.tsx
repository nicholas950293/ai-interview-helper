import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { ApiError, fetchSession, redeemToken } from '../services/api';
import { AppLayout } from './AppLayout';

/**
 * 路由 `/s/:token`。
 *
 * 只有一條路徑，不引入 router 套件——多一個相依換不到任何東西。
 */
function parseToken(pathname: string): string | null {
  const match = /^\/s\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * 場次載入流程：
 *   1. 以路徑上的 token 兌換 session cookie（重複開啟時沿用既有場次）
 *   2. 取回場次、題目、草稿與對話，載入 store
 *   3. 兌換成功後將 token 自網址移除，避免留在瀏覽器歷史或被分享出去
 */
async function loadSession(token: string): Promise<void> {
  const store = useSessionStore.getState();
  store.setLoading();

  try {
    await redeemToken(token);
    const payload = await fetchSession();
    useSessionStore.getState().loadSession(payload);
    window.history.replaceState({}, '', '/s');
  } catch (err) {
    const apiError =
      err instanceof ApiError
        ? { code: err.code, message: err.message }
        : { code: 'INTERNAL_ERROR', message: '系統發生非預期錯誤，請稍後再試。' };
    useSessionStore.getState().setLoadError(apiError);
  }
}

export function AppRoutes() {
  const phase = useSessionStore((s) => s.phase);
  const loadError = useSessionStore((s) => s.loadError);
  const [token] = useState(() => parseToken(window.location.pathname));

  useEffect(() => {
    if (!token) {
      // 重新整理後 token 已從網址移除，改以既有 cookie 還原場次。
      void (async () => {
        useSessionStore.getState().setLoading();
        try {
          const payload = await fetchSession();
          useSessionStore.getState().loadSession(payload);
        } catch (err) {
          const apiError =
            err instanceof ApiError
              ? { code: err.code, message: err.message }
              : { code: 'INTERNAL_ERROR', message: '系統發生非預期錯誤，請稍後再試。' };
          useSessionStore.getState().setLoadError(apiError);
        }
      })();
      return;
    }
    void loadSession(token);
  }, [token]);

  if (phase === 'ready') {
    return <AppLayout />;
  }

  if (phase === 'error' && loadError) {
    return <LoadErrorScreen code={loadError.code} message={loadError.message} />;
  }

  return <LoadingScreen />;
}

function LoadingScreen() {
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

/** 連結失效、場次已提交或尚未開始時 MUST 顯示明確狀態，且不得進入可作答狀態（FR-031）。 */
function LoadErrorScreen({ code, message }: { code: string; message: string }) {
  const retryable = code === 'NETWORK_OFFLINE' || code === 'INTERNAL_ERROR';

  return (
    <div className="flex h-full items-center justify-center p-8" role="alert">
      <div className="card max-w-lg p-8">
        <h1 className="text-lg font-semibold text-text-primary">無法進入面試場次</h1>
        <p className="mt-3 text-text-secondary">{message}</p>
        <p className="mt-4 text-sm text-text-muted">
          狀態代碼：<code>{code}</code>
        </p>
        {retryable && (
          <button
            type="button"
            className="mt-6 rounded-lg bg-accent px-4 py-2 text-text-inverse hover:bg-accent-hover"
            onClick={() => window.location.reload()}
          >
            重新嘗試
          </button>
        )}
      </div>
    </div>
  );
}
