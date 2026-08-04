import { useCallback, useEffect, useRef, useState } from 'react';
import { clampSplit, SPLIT_DEFAULT } from '../../app/AppLayout';

/**
 * 版面比例拖曳（T098）。
 *
 * 憲章原則 V：左右比例 MUST 維持在 7:5 至 6:4 之間。
 * 因此拖曳範圍與本機偏好還原都經過 `clampSplit`——
 * 存在偏好裡的超界值會被夾回邊界，而不是照原值套用。
 */
const STORAGE_KEY_HORIZONTAL = 'portal.split.horizontal';
const STORAGE_KEY_VERTICAL = 'portal.split.vertical';

/** 上下比例不受憲章約束，但仍需留下可用的最小高度。 */
const VERTICAL_MIN = 0.25;
const VERTICAL_MAX = 0.75;
const VERTICAL_DEFAULT = 0.5;

export function clampVertical(ratio: number): number {
  if (!Number.isFinite(ratio)) return VERTICAL_DEFAULT;
  return Math.min(VERTICAL_MAX, Math.max(VERTICAL_MIN, ratio));
}

function readPreference(key: string, fallback: number, clamp: (n: number) => number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    // 偏好值可能來自舊版或被手動竄改，一律夾制後才使用。
    return clamp(Number.parseFloat(raw));
  } catch {
    return fallback;
  }
}

function writePreference(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 隱私模式下 localStorage 可能不可寫；偏好保存失敗不影響作答。
  }
}

export interface SplitPreferences {
  horizontal: number;
  vertical: number;
  setHorizontal: (ratio: number) => void;
  setVertical: (ratio: number) => void;
}

export function useSplitPreferences(): SplitPreferences {
  const [horizontal, setHorizontalState] = useState(() =>
    readPreference(STORAGE_KEY_HORIZONTAL, SPLIT_DEFAULT, clampSplit)
  );
  const [vertical, setVerticalState] = useState(() =>
    readPreference(STORAGE_KEY_VERTICAL, VERTICAL_DEFAULT, clampVertical)
  );

  const setHorizontal = useCallback((ratio: number) => {
    const clamped = clampSplit(ratio);
    setHorizontalState(clamped);
    writePreference(STORAGE_KEY_HORIZONTAL, clamped);
  }, []);

  const setVertical = useCallback((ratio: number) => {
    const clamped = clampVertical(ratio);
    setVerticalState(clamped);
    writePreference(STORAGE_KEY_VERTICAL, clamped);
  }, []);

  return { horizontal, vertical, setHorizontal, setVertical };
}

interface ResizableSplitProps {
  orientation: 'horizontal' | 'vertical';
  value: number;
  onChange: (ratio: number) => void;
  label: string;
  /** 拖曳時用來換算比例的容器。 */
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * 分隔拖曳把手。鍵盤同樣可操作（憲章原則 V：所有互動元件 MUST 可鍵盤操作）。
 */
export function ResizableSplit({
  orientation,
  value,
  onChange,
  label,
  containerRef,
}: ResizableSplitProps) {
  const draggingRef = useRef(false);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio =
        orientation === 'horizontal'
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height;
      onChange(ratio);
    };

    const stop = () => {
      draggingRef.current = false;
      document.body.style.removeProperty('user-select');
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', stop);
    };
  }, [containerRef, onChange, orientation]);

  const step = 0.01;

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      data-testid={`split-${orientation}`}
      onMouseDown={() => {
        draggingRef.current = true;
        document.body.style.setProperty('user-select', 'none');
      }}
      onKeyDown={(event) => {
        const decrease = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
        const increase = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
        if (event.key === decrease) {
          event.preventDefault();
          onChange(value - step);
        } else if (event.key === increase) {
          event.preventDefault();
          onChange(value + step);
        }
      }}
      className={
        orientation === 'horizontal'
          ? 'w-1.5 cursor-col-resize rounded-full bg-border hover:bg-border-strong'
          : 'h-1.5 cursor-row-resize rounded-full bg-border hover:bg-border-strong'
      }
    />
  );
}
