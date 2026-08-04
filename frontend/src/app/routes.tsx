import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { ApiError, fetchSession, redeemToken } from '../services/api';
import { initConnectivity } from '../services/connectivity';
import { startTabGuard } from '../services/tab-guard';
import { selectHasUnsavedChanges } from '../store/selectors';
import { AppLayout } from './AppLayout';
import { DuplicateTabScreen, LoadErrorScreen, LoadingScreen } from './ErrorStates';
import { Toaster } from '../components/ui/toast';
import { QuestionTabs } from '../components/question/QuestionTabs';
import { QuestionContent } from '../components/question/QuestionContent';
import { AskAiButton } from '../components/question/AskAiButton';
import { AnswerWorkspace } from '../components/workspace/AnswerWorkspace';
import { CopilotPanel } from '../components/copilot/CopilotPanel';
import { AppHeader } from '../components/header/AppHeader';

/**
 * 路由 `/s/:token`。
 *
 * 只有一條路徑，不引入 router 套件——多一個相依換不到任何東西。
 */
function parseToken(pathname: string): string | null {
  const match = /^\/s\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function toLoadError(err: unknown): { code: string; message: string } {
  return err instanceof ApiError
    ? { code: err.code, message: err.message }
    : { code: 'INTERNAL_ERROR', message: '系統發生非預期錯誤，請稍後再試。' };
}

/**
 * 場次載入流程：
 *   1. 以路徑上的 token 兌換 session cookie（重複開啟時沿用既有場次）
 *   2. 取回場次、題目、草稿與對話，載入 store
 *   3. 兌換成功後將 token 自網址移除，避免留在瀏覽器歷史或被分享出去
 *
 * 重新整理後 token 已不在網址上，此時以既有 cookie 還原場次。
 */
async function loadSession(token: string | null): Promise<void> {
  useSessionStore.getState().setLoading();

  try {
    if (token !== null) {
      await redeemToken(token);
    }
    const payload = await fetchSession();
    useSessionStore.getState().loadSession(payload);
    if (token !== null) {
      window.history.replaceState({}, '', '/s');
    }
  } catch (err) {
    useSessionStore.getState().setLoadError(toLoadError(err));
  }
}

export function AppRoutes() {
  const phase = useSessionStore((s) => s.phase);
  const loadError = useSessionStore((s) => s.loadError);
  const sessionId = useSessionStore((s) => s.session?.id ?? null);
  const [token] = useState(() => parseToken(window.location.pathname));
  const [duplicateTab, setDuplicateTab] = useState(false);

  useEffect(() => {
    void loadSession(token);
  }, [token]);

  useEffect(() => {
    if (phase !== 'ready') return;
    return initConnectivity();
  }, [phase]);

  // 同一場次在兩個分頁同時開啟：後開者退讓，避免草稿互相覆蓋。
  useEffect(() => {
    if (sessionId === null) return;
    return startTabGuard({ sessionId, onDuplicate: () => setDuplicateTab(true) });
  }, [sessionId]);

  // 尚有未保存變更時，離開前提示。
  useEffect(() => {
    if (phase !== 'ready') return;

    const handler = (event: BeforeUnloadEvent) => {
      if (!selectHasUnsavedChanges(useSessionStore.getState())) return;
      event.preventDefault();
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  if (duplicateTab) {
    return <DuplicateTabScreen />;
  }

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
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              <QuestionTabs>
                <QuestionContent />
              </QuestionTabs>
            </div>
            <div className="shrink-0 border-t border-border px-4 py-2">
              <AskAiButton />
            </div>
          </div>
        }
        answerPanel={<AnswerWorkspace />}
        copilotPanel={<CopilotPanel />}
      />
      <Toaster />
    </>
  );
}
