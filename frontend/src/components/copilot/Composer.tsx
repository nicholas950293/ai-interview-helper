import { useState, type KeyboardEvent } from 'react';
import { useIsReadOnly, useSession, useStreaming } from '../../store/selectors';
import { sendChat } from '../../store/actions';

/**
 * 唯讀時的提示文字。
 *
 * `isReadOnly` 是「非 in_progress」，`not_started` 也包含在內——
 * 對一個還沒開始的場次說「已結束」剛好講反，會讓應試者以為錯過了時間。
 */
function readOnlyHint(status: string | undefined): string {
  if (status === 'not_started') return '場次尚未開始，請由邀請連結進入。';
  return '場次已結束，無法再提問。';
}

/**
 * 輸入區（FR-009）。
 *
 * 多行輸入 + Ctrl/Cmd+Enter 送出（鍵盤契約）。串流期間送出按鈕 MUST 呈忙碌且不可重複送出。
 */
export function Composer() {
  const streaming = useStreaming();
  const readOnly = useIsReadOnly();
  const session = useSession();
  const [value, setValue] = useState('');

  const busy = streaming.active;
  const disabled = readOnly || busy;

  const submit = async (attachCode: boolean) => {
    const content = value.trim();
    if (content.length === 0 || disabled) return;
    setValue('');
    await sendChat({ content, attachCode, source: 'typed' });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit(false);
    }
  };

  return (
    <div className="border-t border-border p-3">
      <label htmlFor="composer-input" className="sr-only">
        向 AI 提問
      </label>
      <textarea
        id="composer-input"
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          readOnly ? readOnlyHint(session?.status) : '描述你卡住的地方…（Ctrl+Enter 送出）'
        }
        className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted disabled:opacity-60"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void submit(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-subtle disabled:opacity-60"
        >
          <span aria-hidden="true">📎 </span>
          附帶目前程式碼
        </button>

        {/* 語音輸入僅保留介面入口，本期不實作辨識（spec Assumptions）。 */}
        <button
          type="button"
          disabled
          title="語音輸入將於後續版本提供"
          aria-label="語音輸入（尚未提供）"
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted opacity-60"
        >
          <span aria-hidden="true">🎙</span>
        </button>

        <span className="ml-auto text-xs text-text-muted">Ctrl+Enter 送出</span>

        <button
          type="button"
          disabled={disabled || value.trim().length === 0}
          onClick={() => void submit(false)}
          aria-busy={busy}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm text-text-inverse hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? '回覆中…' : '送出'}
        </button>
      </div>
    </div>
  );
}
