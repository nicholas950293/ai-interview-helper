import { useState } from 'react';
import { useSessionStore } from '../../store/session';
import { runTests, ApiError } from '../../services/api';
import { toast } from '../ui/toast';

/**
 * 執行單元測試（FR-008 / FR-030）。
 *
 * 本期回報該題預定義的測試結果，MUST NOT 送出應試者的程式碼——
 * 因此這裡只帶 questionId，不帶任何作答內容。
 */
export function TestConsole({ questionId, disabled }: { questionId: string; disabled?: boolean }) {
  const setTestResult = useSessionStore((s) => s.setTestResult);
  const lastResult = useSessionStore((s) => s.lastTestResult);
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    try {
      const result = await runTests(questionId);
      setTestResult({ questionId, ...result });
      toast({
        tone: result.passed === result.total ? 'success' : 'warning',
        title: `通過 ${result.passed}/${result.total} 個測試案例`,
        description:
          result.passed === result.total
            ? '所有預定義的測試案例皆通過。'
            : '仍有測試案例未通過，可再檢視邊界條件。',
      });
    } catch (err) {
      toast({
        tone: 'danger',
        title: '無法執行測試',
        description: err instanceof ApiError ? err.message : '請稍後再試。',
      });
    } finally {
      setRunning(false);
    }
  };

  const resultForThisQuestion = lastResult?.questionId === questionId ? lastResult : null;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void handleRun()}
        disabled={disabled || running}
        className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-subtle disabled:opacity-60"
      >
        {running ? '執行中…' : '執行單元測試'}
      </button>

      {resultForThisQuestion && (
        <span
          data-testid="test-result"
          aria-live="polite"
          className={`text-sm ${
            resultForThisQuestion.passed === resultForThisQuestion.total
              ? 'text-success-text'
              : 'text-warning-text'
          }`}
        >
          <span aria-hidden="true">
            {resultForThisQuestion.passed === resultForThisQuestion.total ? '✅' : '⚠️'}{' '}
          </span>
          通過 {resultForThisQuestion.passed}/{resultForThisQuestion.total} 個測試案例
        </span>
      )}
    </div>
  );
}
