import { GuardrailBanner } from './GuardrailBanner';
import { ModeToggle } from './ModeToggle';
import { ChatFeed } from './ChatFeed';
import { QuickPromptChips } from './QuickPromptChips';
import { Composer } from './Composer';

/**
 * AI 側欄的組裝點（US2）。
 *
 * `AI_UNAVAILABLE` 與連線中斷的錯誤由 `sendChat` 轉成 Feed 中的系統訊息呈現，
 * 應試者的作答內容完全不受影響（FR-014）——這是刻意的：錯誤留在對話裡，
 * 不用 Toast 或 Dialog 打斷正在思考的人。
 *
 * In-Context 狀態列由 US3 的 T072 接上。
 */
export function CopilotPanel() {
  return (
    <div className="flex h-full flex-col">
      <GuardrailBanner />

      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-text-primary">AI 助教</span>
        <ModeToggle />
      </div>

      <div className="min-h-0 flex-1">
        <ChatFeed />
      </div>

      <div className="shrink-0">
        <QuickPromptChips />
        <Composer />
      </div>
    </div>
  );
}
