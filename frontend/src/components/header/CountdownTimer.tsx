import { useEffect, useRef, useState } from 'react';
import { useCountdown, type TimerPhase } from '../../lib/use-countdown';

/**
 * 倒數計時器（FR-020 / contracts/ui-contracts.md「倒數計時器」）。
 *
 * | 剩餘時間 | 呈現 | 行為 |
 * | > 5 分 | 一般樣式 | — |
 * | ≤ 5 分 | 警示樣式 + assertive 宣告一次 | — |
 * | = 0 | 鎖定樣式 | 鎖定全部輸入並觸發強制提交 |
 *
 * 警示只宣告一次——每秒重複宣告會讓螢幕閱讀器使用者無法繼續作答。
 */
const PHASE_CLASSES: Record<TimerPhase, string> = {
  normal: 'text-text-primary',
  warning: 'text-danger-text font-semibold',
  expired: 'text-text-muted',
};

const PHASE_ICONS: Record<TimerPhase, string> = {
  normal: '⏱',
  warning: '⚠️',
  expired: '⏹',
};

export function CountdownTimer({ onExpire }: { onExpire: () => void }) {
  const { remainingSec, phase, label } = useCountdown(onExpire);
  const [announcement, setAnnouncement] = useState('');
  const warnedRef = useRef(false);

  useEffect(() => {
    if (phase === 'warning' && !warnedRef.current) {
      warnedRef.current = true;
      setAnnouncement(`剩餘時間不足 5 分鐘，目前剩餘 ${label}。`);
    }
    if (phase === 'expired') {
      setAnnouncement('時間已到，系統正在自動提交你的作答。');
    }
  }, [phase, label]);

  return (
    <div className="flex items-center gap-2" data-testid="countdown" data-phase={phase}>
      <span aria-hidden="true">{PHASE_ICONS[phase]}</span>
      <span className={`font-mono tabular-nums ${PHASE_CLASSES[phase]}`}>{label}</span>
      <span className="sr-only">
        剩餘時間 {Math.floor(remainingSec / 60)} 分 {remainingSec % 60} 秒
      </span>

      {/* 警示與歸零各宣告一次，不隨每秒更新重複朗讀 */}
      <span role="status" aria-live="assertive" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
