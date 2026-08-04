import { useRef, type ReactNode } from 'react';
import { ResizableSplit, useSplitPreferences } from '../components/layout/ResizableSplit';

/**
 * 三面板版面骨架（contracts/ui-contracts.md「版面契約」）。
 *
 * 左右比例以 CSS grid 控制並鎖在 7:5 至 6:4 之間（憲章原則 V）；
 * 拖曳與偏好還原都經過 `clampSplit`，超界值一律夾回邊界。
 *
 * 桌機限定：最小支援視窗寬度 1280px，低於此寬度以水平捲動呈現完整版面，
 * 不做堆疊或收合的響應式版面。
 */
export const SPLIT_MIN = 7 / 12; // 7:5
export const SPLIT_MAX = 6 / 10; // 6:4
export const SPLIT_DEFAULT = SPLIT_MAX;

/** 將任意比例夾回憲章允許的區間。偏好值還原時同樣 MUST 經過此函式。 */
export function clampSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
}

interface AppLayoutProps {
  header?: ReactNode;
  questionPanel?: ReactNode;
  answerPanel?: ReactNode;
  copilotPanel?: ReactNode;
}

export function AppLayout({ header, questionPanel, answerPanel, copilotPanel }: AppLayoutProps) {
  const mainRef = useRef<HTMLElement | null>(null);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);
  const { horizontal, vertical, setHorizontal, setVertical } = useSplitPreferences();

  const left = clampSplit(horizontal);

  return (
    <div className="flex h-full min-w-[var(--layout-min-width)] flex-col bg-bg">
      <header className="shrink-0">{header}</header>

      <main
        ref={mainRef}
        className="grid min-h-0 flex-1 gap-(--layout-gap) p-(--layout-gap)"
        style={{ gridTemplateColumns: `${left}fr auto ${1 - left}fr` }}
      >
        {/* 左欄：題目區（上）＋作答區（下） */}
        <div
          ref={leftColumnRef}
          className="grid min-h-0"
          style={{ gridTemplateRows: `${vertical}fr auto ${1 - vertical}fr` }}
        >
          <section aria-label="題目" className="card min-h-0 overflow-hidden">
            {questionPanel}
          </section>

          <div className="flex items-center justify-center py-1">
            <ResizableSplit
              orientation="vertical"
              value={vertical}
              onChange={setVertical}
              label="調整題目區與作答區的高度比例"
              containerRef={leftColumnRef}
            />
          </div>

          <section aria-label="作答區" className="card min-h-0 overflow-hidden">
            {answerPanel}
          </section>
        </div>

        <div className="flex items-center justify-center px-1">
          <ResizableSplit
            orientation="horizontal"
            value={horizontal}
            onChange={setHorizontal}
            label="調整左右面板的寬度比例（限 6:4 至 7:5）"
            containerRef={mainRef}
          />
        </div>

        {/* 右欄：AI 側欄 */}
        <aside aria-label="AI 協作" className="card min-h-0 overflow-hidden">
          {copilotPanel}
        </aside>
      </main>
    </div>
  );
}
