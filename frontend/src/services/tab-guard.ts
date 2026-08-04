/**
 * 多分頁同場次偵測（Edge Case：同一場次在兩個分頁同時開啟）。
 *
 * 兩個分頁各自 debounce 保存會互相覆蓋草稿。以 BroadcastChannel 讓先開的分頁
 * 知道有新分頁進來，並讓後開的分頁轉為唯讀提示——
 * 由後開者退讓，因為先開的那個很可能正在作答中。
 */
const CHANNEL_NAME = 'techinterview-portal.session';

type Message =
  | { kind: 'hello'; sessionId: string; tabId: string }
  | { kind: 'already-open'; sessionId: string; tabId: string };

export interface TabGuardOptions {
  sessionId: string;
  /** 本分頁被判定為「後開者」時呼叫。 */
  onDuplicate: () => void;
}

export function startTabGuard({ sessionId, onDuplicate }: TabGuardOptions): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    return () => {};
  }

  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = new BroadcastChannel(CHANNEL_NAME);

  const handle = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (message.sessionId !== sessionId || message.tabId === tabId) return;

    // 有新分頁打招呼：我先在，回一則告知對方它是後開的。
    if (message.kind === 'hello') {
      channel.postMessage({ kind: 'already-open', sessionId, tabId } satisfies Message);
      return;
    }

    if (message.kind === 'already-open') {
      onDuplicate();
    }
  };

  channel.addEventListener('message', handle);
  channel.postMessage({ kind: 'hello', sessionId, tabId } satisfies Message);

  return () => {
    channel.removeEventListener('message', handle);
    channel.close();
  };
}
