import { useState } from 'react';
import { useSessionStore } from '../../store/session';
import { useCurrentAnswer, useCurrentQuestion, useIsReadOnly } from '../../store/selectors';
import { scheduleSave } from '../../store/persistence';
import { formatCode } from '../../lib/format-code';
import { toast } from '../ui/toast';
import { CodeEditor } from './CodeEditor';
import { LanguageSelect } from './LanguageSelect';
import { SaveIndicator } from './SaveIndicator';
import { TestConsole } from './TestConsole';
import { SendToAiButton } from './SendToAiButton';

/** 作答內容上限，與伺服端的 `CONTENT_TOO_LARGE` 門檻一致。 */
const MAX_CONTENT_BYTES = 256 * 1024;

/**
 * 作答區（US1 的組裝點）。
 *
 * 一切狀態都來自 store，本元件不保有 currentQuestion / language / draft 的副本（憲章原則 II）。
 */
export function AnswerWorkspace() {
  const question = useCurrentQuestion();
  const answer = useCurrentAnswer();
  const readOnly = useIsReadOnly();
  const setDraft = useSessionStore((s) => s.setDraft);
  const [formatting, setFormatting] = useState(false);
  const [oversizedNotified, setOversizedNotified] = useState(false);

  if (!question || !answer) {
    return <p className="p-4 text-text-muted">尚未載入題目。</p>;
  }

  const handleChange = (next: string) => {
    setDraft(question.id, next);
    scheduleSave(question.id);
  };

  const handleFormat = async () => {
    setFormatting(true);
    try {
      const result = await formatCode(answer.content, answer.language);
      if (result.ok && result.code !== answer.content) {
        setDraft(question.id, result.code);
        scheduleSave(question.id);
      }
      toast({
        tone: result.ok ? 'success' : 'warning',
        title: result.ok ? '程式碼格式化完成' : '無法格式化',
        description: result.message,
      });
    } finally {
      setFormatting(false);
    }
  };

  const handleOversized = (bytes: number) => {
    if (oversizedNotified) return;
    setOversizedNotified(true);
    toast({
      tone: 'warning',
      title: '內容已超過 256 KB 上限',
      description: `目前約 ${Math.round(bytes / 1024)} KB，超出部分將無法儲存至伺服端，請精簡內容。`,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <LanguageSelect
          question={question}
          language={answer.language}
          content={answer.content}
          disabled={readOnly}
        />

        <button
          type="button"
          onClick={() => void handleFormat()}
          disabled={readOnly || formatting}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-subtle disabled:opacity-60"
        >
          程式碼格式化
        </button>

        <TestConsole questionId={question.id} disabled={readOnly} />

        <SendToAiButton />

        <div className="ml-auto">
          <SaveIndicator questionId={question.id} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <CodeEditor
          value={answer.content}
          onChange={handleChange}
          language={answer.language}
          readOnly={readOnly}
          maxBytes={MAX_CONTENT_BYTES}
          onOversized={handleOversized}
        />
      </div>
    </div>
  );
}
