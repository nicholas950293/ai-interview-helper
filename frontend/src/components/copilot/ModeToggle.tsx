import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useSessionStore } from '../../store/session';
import { useGuidanceMode, useIsReadOnly } from '../../store/selectors';
import { setGuidanceMode as persistGuidanceMode } from '../../services/api';
import type { GuidanceMode } from '../../types';

const MODES: { value: GuidanceMode; label: string; hint: string }[] = [
  { value: 'light', label: '輕度引導', hint: '精簡提示，點到為止' },
  { value: 'deep', label: '深入討論', hint: '展開權衡與取捨的分析' },
];

/**
 * 引導模式切換（FR-012）。
 *
 * 模式只影響回覆的詳細度；圍欄段落不隨模式變動（憲章原則 I）。
 * 切換 MUST NOT 清空既有對話——這裡只改狀態，不動 chat。
 */
export function ModeToggle() {
  const mode = useGuidanceMode();
  const readOnly = useIsReadOnly();
  const setMode = useSessionStore((s) => s.setGuidanceMode);

  const handleChange = (next: string) => {
    if (next !== 'light' && next !== 'deep') return;
    setMode(next);
    // 伺服端保存失敗不影響本次對話，下一次提問會再帶上目前模式。
    void persistGuidanceMode(next).catch(() => setMode(mode));
  };

  return (
    <ToggleGroup.Root
      type="single"
      value={mode}
      onValueChange={handleChange}
      aria-label="AI 引導模式"
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
