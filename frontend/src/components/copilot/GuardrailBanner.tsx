/**
 * AI 使用規範長駐 Banner（FR-011）。
 *
 * 側欄頂部常駐，不可關閉——應試者在任何時候都應該知道這個 AI 的邊界在哪，
 * 事後才發現「原來不會給答案」對計時中的人是實質損害。
 */
export function GuardrailBanner() {
  return (
    <div className="border-b border-border bg-accent-subtle px-3 py-2">
      <p className="text-xs leading-relaxed text-text-secondary">
        <span aria-hidden="true">💡 </span>
        <span className="font-medium text-text-primary">AI 助教會陪你想，但不會替你寫。</span>{' '}
        它可以反問邊界條件、分析複雜度、指出問題所在與修正方向，
        但不會提供可直接貼上就通過測試的完整實作——兩種引導模式都一樣。
        完整對話會隨作答一併留存，供後續評分參考。
      </p>
    </div>
  );
}
