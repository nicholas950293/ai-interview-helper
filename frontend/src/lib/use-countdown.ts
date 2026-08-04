import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';
import { computeRemainingSec } from '../store/selectors';
import { fetchTime } from '../services/api';

/** 剩餘不足 5 分鐘時轉為警示呈現（FR-020）。 */
export const WARNING_THRESHOLD_SEC = 5 * 60;

/** 校時週期。每秒查詢伺服端的請求量與失敗處理成本不成比例（R-007）。 */
export const CLOCK_SYNC_INTERVAL_MS = 30_000;

export type TimerPhase = 'normal' | 'warning' | 'expired';

export interface CountdownState {
  remainingSec: number;
  phase: TimerPhase;
  label: string;
}

export function formatRemaining(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function phaseFor(remainingSec: number): TimerPhase {
  if (remainingSec <= 0) return 'expired';
  if (remainingSec <= WARNING_THRESHOLD_SEC) return 'warning';
  return 'normal';
}

/**
 * 倒數計時（R-007）。
 *
 * 本地每秒遞減保證顯示流暢，每 30 秒與伺服端校時修正漂移。
 * 權威來自 `deadlineAt` 與校時偏移，MUST NOT 以純本地累加計時——
 * 累加會隨分頁休眠而失準，而計時錯誤在面試場景不可回復。
 *
 * @param onExpire 歸零時觸發一次；重複歸零不會重複呼叫。
 */
export function useCountdown(onExpire?: () => void): CountdownState {
  const deadlineAt = useSessionStore((s) => s.session?.deadlineAt ?? null);
  const clockOffsetMs = useSessionStore((s) => s.clockOffsetMs);
  const [remainingSec, setRemainingSec] = useState(() =>
    computeRemainingSec(deadlineAt, clockOffsetMs)
  );

  useEffect(() => {
    let expiredHandled = false;

    const tick = () => {
      const next = computeRemainingSec(deadlineAt, clockOffsetMs);
      setRemainingSec(next);

      if (next <= 0 && !expiredHandled && deadlineAt !== null) {
        expiredHandled = true;
        onExpire?.();
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
    // onExpire 以 ref 語意處理會讓這裡更囉嗦；呼叫端傳穩定的函式即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, clockOffsetMs]);

  // 週期校時：同時取得伺服端判定的場次狀態，逾時強制提交由伺服端主動觸發。
  useEffect(() => {
    if (deadlineAt === null) return;

    const sync = async () => {
      try {
        const result = await fetchTime();
        useSessionStore.getState().syncClock(result.serverTime);
        if (result.status !== useSessionStore.getState().session?.status) {
          useSessionStore.getState().setSessionStatus(result.status);
        }
      } catch {
        // 校時失敗不影響本地顯示，下一輪再試。
      }
    };

    const timer = setInterval(() => void sync(), CLOCK_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [deadlineAt]);

  return {
    remainingSec,
    phase: phaseFor(remainingSec),
    label: formatRemaining(remainingSec),
  };
}
