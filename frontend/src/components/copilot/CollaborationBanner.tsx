/**
 * AI 協作說明長駐 Banner（FR-011、T075）。
 *
 * 側欄頂部常駐，不可關閉。憲章原則 I 的知情要求：應試者 MUST 在開始作答前
 * 就知道「AI 全面開放」與「協作歷程會被記錄並作為評分依據」這兩件事——
 * 交卷後才發現每一次套用都被歸屬記錄，對計時中的人是實質損害。
 */
const HEADLINE = 'AI 全面開放，可以直接幫你寫。';

// 中文沒有詞間空格，JSX 的換行卻會被折成一個真的空格——內文一旦被格式化工具
// 重排，畫面上就會冒出「你自己寫的、 或套用」這種空隙。放進字串常數即不受影響。
const BODY =
  '要它產出完整可執行的實作、重構或補測試都可以，兩種模式都不設限。' +
  '評分看的是你怎麼用它——完整對話，以及每一段程式碼的來源' +
  '（你自己寫的、或套用 AI 的輸出），都會被記錄並作為評分依據。';

export function CollaborationBanner() {
  return (
    <div className="border-b border-border bg-accent-subtle px-3 py-2">
      <p className="text-xs leading-relaxed text-text-secondary">
        <span aria-hidden="true">💡 </span>
        <span className="font-medium text-text-primary">{HEADLINE}</span> {BODY}
      </p>
    </div>
  );
}
