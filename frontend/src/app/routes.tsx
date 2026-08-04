import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { ApiError, fetchSession, redeemToken } from '../services/api';
import { initConnectivity } from '../services/connectivity';
import { AppLayout } from './AppLayout';
import { Toaster } from '../components/ui/toast';
import { QuestionTabs } from '../components/question/QuestionTabs';
import { QuestionContent } from '../components/question/QuestionContent';
import { AnswerWorkspace } from '../components/workspace/AnswerWorkspace';
import { useSession } from '../store/selectors';

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

  useEffect(() => {
    if (phase !== 'ready') return;
    return initConnectivity();
  }, [phase]);

  if (phase === 'ready') {
    return <PortalScreen />;
  }

  if (phase === 'error' && loadError) {
    return <LoadErrorScreen code={loadError.code} message={loadError.message} />;
  }

  return <LoadingScreen />;
}

function PortalScreen() {
  return (
    <>
      <AppLayout
        header={<AppHeader />}
        questionPanel={
          <div className="flex h-full flex-col">
            <QuestionTabs />
            <div className="min-h-0 flex-1">
              <QuestionContent />
            </div>
          </div>
        }
        answerPanel={<AnswerWorkspace />}
        copilotPanel={<CopilotPlaceholder />}
      />
      <Toaster />
    </>
  );
}

/** Header 的完整內容（計時器、全螢幕、提交）由 US4 / US5 接上。 */
function AppHeader() {
  const session = useSession();

  return (
    <div className="flex items-center gap-4 border-b border-border bg-surface px-(--layout-gap) py-3">
      <span className="font-semibold text-text-primary">TechInterview Pro</span>
      <span className="text-text-secondary">{session?.positionTitle}</span>
      <span className="ml-auto text-text-secondary">{session?.candidateName}</span>
    </div>
  );
}

/** AI 側欄由 US2 接上。 */
function CopilotPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-muted">
      AI 助教即將在此提供引導。
    </div>
  );
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
