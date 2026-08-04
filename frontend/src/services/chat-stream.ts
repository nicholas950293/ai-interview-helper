/**
 * SSE 用戶端（R-005）。
 *
 * token 以批次方式套用至狀態——效能契約明定 MUST NOT 每個 token 觸發一次全域更新，
 * 否則長回覆會讓整棵樹重繪數百次，直接吃掉編輯器的延遲預算。
 */
import type { CodeBlock } from '../types';

const FLUSH_INTERVAL_MS = 50;

export interface StreamHandlers {
  /** 批次後的增量文字。 */
  onToken: (text: string) => void;
  /**
   * 後端於完整回覆上解析出的可套用區塊（FR-033）。
   * 抵達時串流已結束，此後才能渲染套用按鈕。
   */
  onBlocks: (blocks: CodeBlock[]) => void;
  onDone: (payload: { messageId: string; provider: string; model: string }) => void;
  onError: (payload: { code: string; message: string }) => void;
}

export interface StreamController {
  /** 中止串流（時間歸零、切換題目、元件卸載）。 */
  abort: () => void;
}

export function openChatStream(streamId: string, handlers: StreamHandlers): StreamController {
  const source = new EventSource(`/api/chat/stream/${encodeURIComponent(streamId)}`);

  let buffer = '';
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer;
    buffer = '';
    handlers.onToken(text);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
    source.close();
  };

  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  source.addEventListener('token', (event) => {
    buffer += (JSON.parse((event as MessageEvent).data) as { text: string }).text;
  });

  source.addEventListener('blocks', (event) => {
    // blocks 在 done 之前抵達，但 token 可能還在緩衝區裡；先 flush 再交付，
    // 否則區塊會比它所屬的那段文字更早出現在畫面上。
    flush();
    handlers.onBlocks(
      (JSON.parse((event as MessageEvent).data) as { codeBlocks: CodeBlock[] }).codeBlocks
    );
  });

  source.addEventListener('done', (event) => {
    flush();
    close();
    handlers.onDone(
      JSON.parse((event as MessageEvent).data) as {
        messageId: string;
        provider: string;
        model: string;
      }
    );
  });

  source.addEventListener('error', (event) => {
    const data = (event as MessageEvent).data;
    flush();
    close();

    if (typeof data === 'string') {
      handlers.onError(JSON.parse(data) as { code: string; message: string });
      return;
    }

    // 連線層級的錯誤（沒有 data）——EventSource 會自行重連，這裡直接收掉並回報。
    handlers.onError({
      code: 'AI_UNAVAILABLE',
      message: 'AI 助教的連線中斷了，你的作答內容不受影響，稍後可再試一次。',
    });
  });

  return {
    abort: () => {
      flush();
      close();
    },
  };
}
