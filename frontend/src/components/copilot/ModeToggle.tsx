import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useSessionStore } from '../../store/session';
import { useCollaborationMode, useIsReadOnly } from '../../store/selectors';
import { setCollaborationMode as persistCollaborationMode } from '../../services/api';
import type { CollaborationMode } from '../../types';

const MODES: { value: CollaborationMode; label: string; hint: string }[] = [
  { value: 'implement', label: '實作模式', hint: 'AI 直接產出完整實作' },
  { value: 'discuss', label: '討論模式', hint: 'AI 以說明回應，不產出可套用的程式碼' },
];

/**
 * 引導模式切換（FR-012）。
 *
 * 模式只改變送往模型的系統提示，MUST NOT 限制 AI 輸出的完整性（憲章原則 I）。
 * 切換 MUST NOT 清空既有對話——這裡只改狀態，不動 chat。
 */
export function ModeToggle() {
  const mode = useCollaborationMode();
  const readOnly = useIsReadOnly();
  const setMode = useSessionStore((s) => s.setCollaborationMode);

  const handleChange = (next: string) => {
    if (next !== 'discuss' && next !== 'implement') return;
    setMode(next);
    // 伺服端保存失敗不影響本次對話，下一次提問會再帶上目前模式。
    void persistCollaborationMode(next).catch(() => setMode(mode));
  };

  return (
    <ToggleGroup.Root
      type="single"
      value={mode}
      onValueChange={handleChange}
      aria-label="AI 協作模式"
      disabled={readOnly}
      className="inline-flex rounded-lg border border-border p-0.5"
    >
      {MODES.map((item) => (
        <ToggleGroup.Item
          key={item.value}
          value={item.value}
          title={item.hint}
          aria-label={`${item.label} —— ${item.hint}`}
          className="rounded-md px-3 py-1 text-xs text-text-secondary data-[state=on]:bg-accent-subtle data-[state=on]:font-medium data-[state=on]:text-accent-text"
        >
          {item.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
