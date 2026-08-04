import { applyCodeBlock, blockKeyOf } from '../../store/actions';
import { useApplyingBlockKey, useIsReadOnly } from '../../store/selectors';
import type { CodeBlock as CodeBlockData } from '../../types';

/**
 * AI 產出的程式碼區塊與「套用至編輯器」按鈕（FR-033、ui-contracts A-05）。
 *
 * 內容 MUST 完整顯示、MUST NOT 摺疊或截斷——憲章原則 I 要求應試者能看見
 * AI 的完整輸出。超長區塊以區塊內捲動呈現，捲動容器需可鍵盤聚焦，
 * 否則純鍵盤使用者捲不動它（axe: scrollable-region-focusable）。
 */
export function CodeBlock({
  block,
  messageId,
  total,
}: {
  block: CodeBlockData;
  messageId: string;
  /** 同一則回覆的區塊總數，用來決定按鈕是否需要標示序號。 */
  total: number;
}) {
  const applyingKey = useApplyingBlockKey();
  const readOnly = useIsReadOnly();

  const key = blockKeyOf(messageId, block.blockIndex);
  const applying = applyingKey === key;
  // 同一則回覆有多段時，可存取名稱 MUST 能區分是哪一段——只寫「套用至編輯器」
  // 會讓螢幕閱讀器使用者無從分辨要套用哪一段（ui-contracts）。
  const label = total > 1 ? `套用第 ${block.blockIndex + 1} 段程式碼至編輯器` : '套用至編輯器';

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-subtle px-2 py-1">
        <span className="font-mono text-xs text-text-muted">{block.language ?? '程式碼'}</span>
        <button
          type="button"
          onClick={() => void applyCodeBlock(messageId, block.blockIndex)}
          disabled={readOnly || applyingKey !== null}
          aria-label={label}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-accent-text hover:bg-accent-subtle disabled:opacity-60"
        >
          {applying ? '套用中…' : '套用至編輯器'}
        </button>
      </div>

      <pre
        tabIndex={0}
        role="region"
        aria-label={total > 1 ? `第 ${block.blockIndex + 1} 段程式碼` : '程式碼'}
        className="max-h-80 overflow-auto bg-surface p-2 font-mono text-xs whitespace-pre text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-text"
      >
        {block.content}
      </pre>
    </div>
  );
}
