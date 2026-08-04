import { useAnswer } from '../../store/selectors';
import type { SaveState } from '../../types';

/**
 * 保存狀態指示（contracts/ui-contracts.md「元件狀態契約」）。
 *
 * 憲章原則 V：狀態變化 MUST 同時以視覺與可存取名稱呈現，MUST NOT 僅依賴顏色——
 * 因此每個狀態都有各自的文字與圖示，顏色只是輔助。
 */
const PRESENTATION: Record<
  SaveState,
  { label: string; icon: string; className: string; live: 'off' | 'polite' | 'assertive' }
> = {
  idle: {
    label: '草稿',
    icon: '○',
    className: 'text-text-muted',
    live: 'off',
  },
  saving: {
    label: '儲存草稿中…',
    icon: '◐',
    className: 'text-text-secondary',
    live: 'polite',
  },
  saved: {
    label: '已自動儲存草稿',
    icon: '✓',
    className: 'text-success-text',
    live: 'polite',
  },
  error: {
    label: '儲存失敗，將自動重試',
    icon: '⚠',
    className: 'text-danger-text',
    live: 'assertive',
  },
};

export function SaveIndicator({ questionId }: { questionId: string }) {
  const answer = useAnswer(questionId);
  const state: SaveState = answer?.saveState ?? 'idle';
  const { label, icon, className, live } = PRESENTATION[state];

  return (
    <span
      data-testid="save-indicator"
      data-state={state}
      aria-live={live}
      className={`inline-flex items-center gap-1.5 text-sm ${className}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
