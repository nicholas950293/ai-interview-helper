import { useCurrentQuestion } from '../../store/selectors';

/**
 * 題目內容（FR-002）：描述、輸入/輸出範例、複雜度要求、評分重點。
 *
 * 描述以極輕量的 Markdown 子集呈現（粗體、行內程式碼、清單）——
 * 引入完整 Markdown 套件對三種標記而言是不成比例的相依。
 */
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-text-primary">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={key}
          className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-[0.85em] text-text-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function Description({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');

  return (
    <div className="space-y-2 text-sm leading-relaxed text-text-secondary">
      {lines.map((line, i) => {
        if (line.trim().length === 0) return null;
        if (line.startsWith('- ')) {
          return (
            <p key={i} className="flex gap-2 pl-2">
              <span aria-hidden="true">•</span>
              <span>{renderInline(line.slice(2), `li-${i}`)}</span>
            </p>
          );
        }
        return <p key={i}>{renderInline(line, `p-${i}`)}</p>;
      })}
    </div>
  );
}

export function QuestionContent() {
  const question = useCurrentQuestion();

  if (!question) {
    return <p className="p-4 text-text-muted">尚未載入題目。</p>;
  }

  // 可捲動區域 MUST 可鍵盤聚焦，否則只能用滑鼠捲動（axe: scrollable-region-focusable）
  return (
    <div className="h-full overflow-auto p-4" tabIndex={0} aria-label="題目內容">
      <h2 className="text-base font-semibold text-text-primary">{question.title}</h2>

      <div className="mt-4">
        <Description markdown={question.description} />
      </div>

      {question.examples.length > 0 && (
        <section className="mt-5">
          <h3 className="text-sm font-semibold text-text-primary">輸入 / 輸出範例</h3>
          <div className="mt-2 space-y-3">
            {question.examples.map((example, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface-subtle p-3">
                <div className="text-xs text-text-muted">Input</div>
                <pre className="mt-1 font-mono text-xs whitespace-pre-wrap text-text-primary">
                  {example.input}
                </pre>
                <div className="mt-2 text-xs text-text-muted">Output</div>
                <pre className="mt-1 font-mono text-xs whitespace-pre-wrap text-text-primary">
                  {example.output}
                </pre>
                {example.note && <p className="mt-2 text-xs text-text-secondary">{example.note}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {question.complexityRequirement && (
        <section className="mt-5">
          <h3 className="text-sm font-semibold text-text-primary">複雜度要求</h3>
          <p className="mt-1 text-sm text-text-secondary">{question.complexityRequirement}</p>
        </section>
      )}

      {question.gradingFocus.length > 0 && (
        <section className="mt-5">
          <h3 className="text-sm font-semibold text-text-primary">評分重點</h3>
          <ul className="mt-1 space-y-1 text-sm text-text-secondary">
            {question.gradingFocus.map((focus, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{focus}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
