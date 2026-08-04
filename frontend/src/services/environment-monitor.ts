import { useSessionStore } from '../store/session';
import { enqueueEnvironmentEvent, flushEnvironmentQueue } from '../store/persistence';
import type { EnvironmentEventType } from '../types';

/**
 * 作答環境監測（FR-025 / R-012）。
 *
 * 憲章「防作弊監測」：**全螢幕模式下** MUST 監聽 `blur` 與 `visibilitychange`。
 * 監聽只在全螢幕期間啟用——非全螢幕時記錄等於在應試者沒有被告知的情況下蒐集行為。
 *
 * `blur` 涵蓋切換到其他應用程式，`visibilitychange` 涵蓋切換分頁，兩者互補。
 * 短於 1000ms 的離開不計為事件（濾除 Toast 出現等造成的焦點抖動）。
 */
export const MIN_DURATION_MS = 1000;

export interface EnvironmentMonitorOptions {
  /** 返回時的提醒；記錄 MUST 為事實描述，提醒也不做作弊判定（FR-026）。 */
  onReturn: (event: { type: EnvironmentEventType; durationMs: number }) => void;
}

interface Departure {
  type: EnvironmentEventType;
  startedAt: number;
}

export function startEnvironmentMonitor({ onReturn }: EnvironmentMonitorOptions): () => void {
  let departure: Departure | null = null;

  const depart = (type: EnvironmentEventType) => {
    // 已在記錄中就不重複開始：blur 與 visibilitychange 常常同時觸發。
    if (departure) return;
    departure = { type, startedAt: Date.now() };
  };

  const returned = () => {
    if (!departure) return;

    const durationMs = Date.now() - departure.startedAt;
    const { type } = departure;
    departure = null;

    if (durationMs < MIN_DURATION_MS) return;

    const startedAt = new Date(Date.now() - durationMs).toISOString();
    void enqueueEnvironmentEvent({ type, startedAt, durationMs }).then(() =>
      flushEnvironmentQueue()
    );

    onReturn({ type, durationMs });
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      depart('tab_hidden');
    } else {
      returned();
    }
  };

  const handleBlur = () => depart('window_blur');
  const handleFocus = () => returned();

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('blur', handleBlur);
  window.addEventListener('focus', handleFocus);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('blur', handleBlur);
    window.removeEventListener('focus', handleFocus);
    departure = null;
  };
}

/**
 * 依全螢幕狀態啟停監測。
 * 場次進入終態後也停止——已提交的場次不需要再記錄任何事。
 */
export function syncEnvironmentMonitor(
  isFullscreen: boolean,
  options: EnvironmentMonitorOptions
): (() => void) | undefined {
  const status = useSessionStore.getState().session?.status;
  if (!isFullscreen || status !== 'in_progress') return undefined;
  return startEnvironmentMonitor(options);
}
