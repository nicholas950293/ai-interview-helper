import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatFeed } from '../../src/components/copilot/ChatFeed';
import { Composer } from '../../src/components/copilot/Composer';
import { CollaborationBanner } from '../../src/components/copilot/CollaborationBanner';
import { QuickPromptChips } from '../../src/components/copilot/QuickPromptChips';
import { useSessionStore } from '../../src/store/session';
import { loadTestSession } from '../helpers/store';
import type { ChatMessage } from '../../src/types';

const sendChat = vi.hoisted(() => vi.fn());
const applyCodeBlock = vi.hoisted(() => vi.fn());

vi.mock('../../src/store/actions', async () => {
  const actual = await vi.importActual('../../src/store/actions');
  return { ...actual, sendChat, applyCodeBlock };
});

function message(overrides: Partial<ChatMessage> & { id: string; role: ChatMessage['role'] }) {
  return {
    questionId: 'q1',
    content: '',
    createdAt: '2026-08-04T00:00:00.000Z',
    attachedCode: null,
    ...overrides,
  } as ChatMessage;
}

describe('對話 Feed（contracts/ui-contracts.md「對話 Feed」）', () => {
  beforeEach(() => {
    loadTestSession();
    sendChat.mockClear();
  });

  it('沒有訊息時顯示引導語，不是空白', () => {
    render(<ChatFeed />);
    expect(screen.getByText(/要我實作、重構或解釋都可以/)).toBeInTheDocument();
  });

  it('三種角色各有對應呈現', () => {
    const store = useSessionStore.getState();
    store.appendChatMessage(message({ id: 'm1', role: 'candidate', content: '我的提問' }));
    store.appendChatMessage(message({ id: 'm2', role: 'assistant', content: 'AI 的回覆' }));
    store.appendChatMessage(message({ id: 'm3', role: 'system', content: '已切換題目' }));

    render(<ChatFeed />);

    expect(screen.getByText('我的提問')).toBeInTheDocument();
    expect(screen.getByText('AI 的回覆')).toBeInTheDocument();
    expect(screen.getByText('已切換題目')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('串流中的回覆以 aria-busy 標示，並在尚無內容時顯示思考中', () => {
    useSessionStore
      .getState()
      .appendChatMessage(message({ id: 'm1', role: 'assistant', content: '', pending: true }));

    render(<ChatFeed />);

    expect(screen.getByText('AI 正在思考…')).toBeInTheDocument();
    expect(screen.getByRole('listitem').firstChild).toHaveAttribute('aria-busy', 'true');
  });

  it('串流逐步累積的內容會即時反映', () => {
    const store = useSessionStore.getState();
    store.appendChatMessage(message({ id: 'm1', role: 'assistant', content: '', pending: true }));

    const { rerender } = render(<ChatFeed />);
    store.appendStreamToken('m1', '先想想');
    rerender(<ChatFeed />);
    expect(screen.getByText(/先想想/)).toBeInTheDocument();

    store.appendStreamToken('m1', '邊界條件。');
    rerender(<ChatFeed />);
    expect(screen.getByText(/先想想邊界條件。/)).toBeInTheDocument();
  });

  it('附帶程式碼的提問標示「已附帶程式碼」且可展開', async () => {
    const user = userEvent.setup();
    useSessionStore.getState().appendChatMessage(
      message({
        id: 'm1',
        role: 'candidate',
        content: '幫我看看',
        attachedCode: 'const x = 1;',
      })
    );

    render(<ChatFeed />);

    const toggle = screen.getByRole('button', { name: /已附帶程式碼/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('const x = 1;')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });
});

describe('輸入區（FR-009）', () => {
  beforeEach(() => {
    loadTestSession();
    sendChat.mockClear();
  });

  it('Ctrl+Enter 送出提問', async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByLabelText('向 AI 提問'), '邊界條件有哪些？');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(sendChat).toHaveBeenCalledWith({
      content: '邊界條件有哪些？',
      attachCode: false,
      source: 'typed',
    });
  });

  it('點擊送出按鈕同樣送出', async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByLabelText('向 AI 提問'), '提示？');
    await user.click(screen.getByRole('button', { name: '送出' }));

    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  it('串流期間送出按鈕呈忙碌且不可重複送出', async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByLabelText('向 AI 提問'), '提示？');
    useSessionStore.getState().setStreaming({ active: true, messageId: 'm1' });

    const button = await screen.findByRole('button', { name: '回覆中…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(sendChat).not.toHaveBeenCalled();
  });

  it('空白內容不送出', async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByLabelText('向 AI 提問'), '   ');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(sendChat).not.toHaveBeenCalled();
  });

  it('場次結束後輸入區轉為唯讀', () => {
    useSessionStore.getState().setSessionStatus('submitted');
    render(<Composer />);

    expect(screen.getByLabelText('向 AI 提問')).toBeDisabled();
  });

  it('「附帶目前程式碼」以 attachCode 送出', async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByLabelText('向 AI 提問'), '檢查一下');
    await user.click(screen.getByRole('button', { name: /附帶目前程式碼/ }));

    expect(sendChat).toHaveBeenCalledWith({
      content: '檢查一下',
      attachCode: true,
      source: 'typed',
    });
  });

  it('語音輸入僅保留入口，本期不可用', () => {
    render(<Composer />);
    expect(screen.getByLabelText('語音輸入（尚未提供）')).toBeDisabled();
  });
});

describe('AI 產出的程式碼區塊與套用按鈕（FR-033、ui-contracts A-05）', () => {
  const reply = '我先做一版：\n\n```javascript\nfunction solve() {}\n```\n\n複雜度 O(n)。';

  const withBlocks = (blocks: { blockIndex: number; language: string | null; content: string }[]) =>
    message({ id: 'm-ai', role: 'assistant', content: reply, codeBlocks: blocks });

  beforeEach(() => {
    loadTestSession();
    applyCodeBlock.mockClear();
  });

  it('串流中 MUST NOT 出現套用按鈕，但程式碼照樣完整可見', () => {
    useSessionStore
      .getState()
      .appendChatMessage(message({ id: 'm-ai', role: 'assistant', content: reply, pending: true }));

    render(<ChatFeed />);

    expect(screen.queryByRole('button', { name: /套用/ })).not.toBeInTheDocument();
    // 憲章原則 I：尚未解析不等於可以先藏起來
    expect(screen.getByText(/function solve/)).toBeInTheDocument();
  });

  it('blocks 抵達後渲染區塊與套用按鈕，內容逐字相同', () => {
    useSessionStore
      .getState()
      .appendChatMessage(
        withBlocks([{ blockIndex: 0, language: 'javascript', content: 'function solve() {}\n' }])
      );

    render(<ChatFeed />);

    expect(screen.getByRole('button', { name: '套用至編輯器' })).toBeEnabled();
    expect(screen.getByText('javascript')).toBeInTheDocument();
    expect(screen.getByText(/function solve\(\) \{\}/)).toBeInTheDocument();
  });

  it('同一則回覆的多個區塊各有可區分的可存取名稱', () => {
    const two = '```javascript\nconst a = 1;\n```\n\n再來：\n\n```javascript\nconst b = 2;\n```';
    useSessionStore.getState().appendChatMessage(
      message({
        id: 'm-ai',
        role: 'assistant',
        content: two,
        codeBlocks: [
          { blockIndex: 0, language: 'javascript', content: 'const a = 1;\n' },
          { blockIndex: 1, language: 'javascript', content: 'const b = 2;\n' },
        ],
      })
    );

    render(<ChatFeed />);

    // 只寫「套用」會讓螢幕閱讀器使用者無從分辨要套用哪一段
    expect(screen.getByRole('button', { name: '套用第 1 段程式碼至編輯器' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '套用第 2 段程式碼至編輯器' })).toBeInTheDocument();
  });

  it('點擊套用時帶上 messageId 與 blockIndex', async () => {
    const user = userEvent.setup();
    useSessionStore
      .getState()
      .appendChatMessage(
        withBlocks([{ blockIndex: 0, language: 'javascript', content: 'function solve() {}\n' }])
      );

    render(<ChatFeed />);
    await user.click(screen.getByRole('button', { name: '套用至編輯器' }));

    expect(applyCodeBlock).toHaveBeenCalledWith('m-ai', 0);
  });

  it('場次進入終態後套用按鈕停用（FR-024）', () => {
    useSessionStore
      .getState()
      .appendChatMessage(
        withBlocks([{ blockIndex: 0, language: 'javascript', content: 'function solve() {}\n' }])
      );
    useSessionStore.getState().setSessionStatus('submitted');

    render(<ChatFeed />);

    expect(screen.getByRole('button', { name: '套用至編輯器' })).toBeDisabled();
  });

  it('某個區塊套用中時，全部套用按鈕停用以免互相覆蓋', () => {
    useSessionStore.getState().appendChatMessage(
      message({
        id: 'm-ai',
        role: 'assistant',
        content: '```javascript\nconst a = 1;\n```\n\n```javascript\nconst b = 2;\n```',
        codeBlocks: [
          { blockIndex: 0, language: 'javascript', content: 'const a = 1;\n' },
          { blockIndex: 1, language: 'javascript', content: 'const b = 2;\n' },
        ],
      })
    );
    useSessionStore.getState().setApplyingBlock('m-ai:0');

    render(<ChatFeed />);

    expect(screen.getByRole('button', { name: '套用第 1 段程式碼至編輯器' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '套用第 2 段程式碼至編輯器' })).toBeDisabled();
    expect(screen.getByText('套用中…')).toBeInTheDocument();
  });
});

describe('AI 協作說明長駐 Banner（FR-011）', () => {
  // 憲章原則 I 的知情要求有兩個缺一不可的部分：AI 全面開放、協作歷程會被評分。
  // 只說前者會讓應試者以為隨便用都沒差，只說後者則讀起來像威脅。
  it('同時說明 AI 全面開放與協作歷程會被記錄評分，且無關閉按鈕', () => {
    render(<CollaborationBanner />);

    expect(screen.getByText(/AI 全面開放/)).toBeInTheDocument();
    expect(screen.getByText(/來源.*都會被記錄並作為評分依據/s)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('不再出現舊定位的圍欄文案', () => {
    render(<CollaborationBanner />);

    expect(screen.queryByText(/不會替你寫/)).not.toBeInTheDocument();
  });
});

describe('快捷提問 Chips（FR-013）', () => {
  beforeEach(() => {
    loadTestSession();
    sendChat.mockClear();
  });

  it('點擊即送出，無需額外輸入', async () => {
    const user = userEvent.setup();
    render(<QuickPromptChips />);

    await user.click(screen.getByRole('button', { name: '檢查 Corner Cases' }));

    expect(sendChat).toHaveBeenCalledWith({
      content: '檢查 Corner Cases',
      source: 'quick_prompt',
    });
  });

  it('串流期間停用，避免重複送出', () => {
    useSessionStore.getState().setStreaming({ active: true, messageId: 'm1' });
    render(<QuickPromptChips />);

    expect(screen.getByRole('button', { name: '檢查 Corner Cases' })).toBeDisabled();
  });
});
