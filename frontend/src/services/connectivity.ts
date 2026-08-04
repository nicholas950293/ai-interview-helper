import { useSessionStore } from '../store/session';
import { flushQueue, flushEnvironmentQueue } from '../store/persistence';

/**
 * 連線狀態偵測與離線佇列補送（FR-028）。
 *
 * `navigator.onLine` 只反映網卡狀態，不保證伺服器可達，
 * 因此補送失敗時會維持 offline 並持續退避重試——寧可多試也不能丟草稿。
 */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
}

async function attemptFlush(): Promise<void> {
  // 草稿與環境事件共用同一輪補送；任一失敗都維持 offline 並重試。
  const [savesOk, eventsOk] = await Promise.all([flushQueue(), flushEnvironmentQueue()]);
  const ok = savesOk && eventsOk;

  if (ok) {
    clearRetry();
    useSessionStore.getState().setConnectivity('online');
    return;
  }

  useSessionStore.getState().setConnectivity('offline');
  retryAttempt += 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** (retryAttempt - 1), RETRY_MAX_MS);
  retryTimer = setTimeout(() => void attemptFlush(), delay);
}

export function initConnectivity(): () => void {
  const handleOnline = () => {
    clearRetry();
    void attemptFlush();
  };

  const handleOffline = () => {
    useSessionStore.getState().setConnectivity('offline');
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  useSessionStore.getState().setConnectivity(navigator.onLine ? 'online' : 'offline');
  if (navigator.onLine) {
    void attemptFlush();
  }

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    clearRetry();
  };
}
