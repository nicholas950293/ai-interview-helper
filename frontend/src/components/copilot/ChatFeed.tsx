import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../../store/selectors';
import { segmentMessage } from '../../lib/message-segments';
import { CodeBlock } from './CodeBlock';
import type { ChatMessage } from '../../types';

/**
 * 對話 Feed（contracts/ui-contracts.md「對話 Feed」）。
 *
 * candidate 右側氣泡、assistant 左側氣泡、system 置中細體分隔訊息。
 * 串流中的訊息以文字與 aria-busy 同時標示，不只靠動畫（憲章原則 V）。
 */
function CandidateMessage({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent-subtle px-3 py-2">
        <p className="text-sm whitespace-pre-wrap text-text-primary">{message.content}</p>

        {message.attachedCode !== null && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="text-xs text-accent-text underline"
            >
              <span aria-hidden="true">📎 </span>
              已附帶程式碼{expanded ? '（收合）' : '（展開）'}
            </button>
            {expanded && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-text-secondary">
                {message.attachedCode}
              </pre>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const streaming = message.pending === true;
  const blockCount = message.codeBlocks?.length ?? 0;

  // 串流期間 blocks 尚未抵達，segmentMessage 會原樣回傳整段文字——
  // 圍籬與程式碼因此照樣逐字顯示，只是還不能套用（ui-contracts）。
  const segments = useMemo(
    () => segmentMessage(message.content, message.codeBlocks),
    [message.content, message.codeBlocks]
  );

  return (
    <li className="flex justify-start">
      <div
        className="max-w-[85%] rounded-lg rounded-bl-sm border border-border bg-surface-subtle px-3 py-2"
        aria-busy={streaming}
      >
        {segments.map((segment) =>
          segment.kind === 'prose' ? (
            <p key={segment.key} className="text-sm whitespace-pre-wrap text-text-primary">
              {segment.text}
            </p>
          ) : (
            <CodeBlock
              key={segment.key}
              block={segment.block}
              messageId={message.id}
              total={blockCount}
            />
          )
        )}

        {streaming && message.content.length === 0 && (
          <p className="text-sm text-text-muted">AI 助教正在思考…</p>
        )}
        {streaming && message.content.length > 0 && (
          <span className="sr-only" aria-live="polite">
            AI 回覆產生中
          </span>
        )}
      </div>
    </li>
  );
}

function SystemMessage({ message }: { message: ChatMessage }) {
  return (
    <li className="flex justify-center">
      <p className="max-w-[90%] text-center text-xs text-text-muted">{message.content}</p>
    </li>
  );
}

export function ChatFeed() {
  const chat = useChat();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat]);

  if (chat.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="max-w-xs text-center text-sm text-text-muted">
          直接說你要什麼。要我實作、重構或解釋都可以，你的每一次提問與套用都會被記錄。
        </p>
      </div>
    );
  }

  return (
    // 對話一長就會產生捲軸，可捲動容器 MUST 可鍵盤聚焦，否則純鍵盤使用者
    // 捲不動它（axe: scrollable-region-focusable）。聚焦的是容器而非內層 ul，
    // 因此名稱掛在這裡，ul 保留 role="list" 的語意給輔助技術瀏覽。
    <div
      tabIndex={0}
      role="region"
      aria-label="與 AI 助教的對話"
      className="h-full overflow-auto px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-text"
    >
      <ul aria-label="與 AI 助教的對話" className="flex flex-col gap-3">
        {chat.map((message) => {
          if (message.role === 'candidate') {
            return <CandidateMessage key={message.id} message={message} />;
          }
          if (message.role === 'assistant') {
            return <AssistantMessage key={message.id} message={message} />;
          }
          return <SystemMessage key={message.id} message={message} />;
        })}
      </ul>
      <div ref={bottomRef} />
    </div>
  );
}
