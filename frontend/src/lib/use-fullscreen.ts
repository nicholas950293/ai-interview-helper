import { useCallback, useEffect, useState } from 'react';

/**
 * 全螢幕切換與狀態同步（FR-024）。
 *
 * 按鈕狀態一律由 `fullscreenchange` 事件驅動，MUST NOT 以點擊時的樂觀假設更新——
 * 使用者可以按 Esc 或 F11 離開全螢幕，那些路徑不經過我們的按鈕。
 */
export interface FullscreenState {
  isFullscreen: boolean;
  supported: boolean;
  toggle: () => Promise<void>;
}

function currentFullscreenElement(): Element | null {
  return document.fullscreenElement ?? null;
}

export function useFullscreen(): FullscreenState {
  const [isFullscreen, setIsFullscreen] = useState(() => currentFullscreenElement() !== null);
  const supported =
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function';

  useEffect(() => {
    const sync = () => setIsFullscreen(currentFullscreenElement() !== null);

    document.addEventListener('fullscreenchange', sync);
    sync();

    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = useCallback(async () => {
    if (!supported) return;

    try {
      if (currentFullscreenElement()) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // 瀏覽器拒絕（例如未經使用者手勢）時，狀態仍由 fullscreenchange 決定，
      // 這裡不做任何樂觀更新，畫面因此不會與實際狀態脫節。
    }
  }, [supported]);

  return { isFullscreen, supported, toggle };
}
