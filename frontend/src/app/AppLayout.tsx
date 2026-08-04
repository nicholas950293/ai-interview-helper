import type { ReactNode } from 'react';

/**
 * 三面板版面骨架（contracts/ui-contracts.md「版面契約」）。
 *
 * 左右比例以 CSS grid 控制並鎖在 6:4–7:5 之間（憲章原則 V）。
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
  /** 左側佔比，預設 6:4；超出 6:4–7:5 的值會被夾回邊界。 */
  split?: number;
}

export function AppLayout({
  header,
  questionPanel,
  answerPanel,
  copilotPanel,
  split = SPLIT_DEFAULT,
}: AppLayoutProps) {
  const left = clampSplit(split);
  const right = 1 - left;

  return (
    <div className="flex h-full min-w-[var(--layout-min-width)] flex-col bg-bg">
      <header className="shrink-0">{header}</header>

      <main
        className="grid min-h-0 flex-1 gap-(--layout-gap) p-(--layout-gap)"
        style={{ gridTemplateColumns: `${left}fr ${right}fr` }}
      >
        {/* 左欄：題目區（上）＋作答區（下） */}
        <div className="grid min-h-0 grid-rows-2 gap-(--layout-gap)">
          <section aria-label="題目" className="card min-h-0 overflow-hidden">
            {questionPanel}
          </section>
          <section aria-label="作答區" className="card min-h-0 overflow-hidden">
            {answerPanel}
          </section>
        </div>

        {/* 右欄：AI 側欄 */}
        <aside aria-label="AI 助教" className="card min-h-0 overflow-hidden">
          {copilotPanel}
        </aside>
      </main>
    </div>
  );
}
