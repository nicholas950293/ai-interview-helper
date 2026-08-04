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

vi.mock('../../src/store/actions', async () => {
  const actual = await vi.importActual('../../src/store/actions');
  return { ...actual, sendChat };
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

    expect(screen.getByText('AI 助教正在思考…')).toBeInTheDocument();
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

    await user.type(screen.getByLabelText('向 AI 助教提問'), '邊界條件有哪些？');
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

    await user.type(screen.getByLabelText('向 AI 助教提問'), '提示？');
    await user.click(screen.getByRole('button', { name: '送出' }));

    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  it('串流期間送出按鈕呈忙碌且不可重複送出', async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByLabelText('向 AI 助教提問'), '提示？');
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

    await user.type(screen.getByLabelText('向 AI 助教提問'), '   ');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(sendChat).not.toHaveBeenCalled();
  });

  it('場次結束後輸入區轉為唯讀', () => {
    useSessionStore.getState().setSessionStatus('submitted');
    render(<Composer />);

    expect(screen.getByLabelText('向 AI 助教提問')).toBeDisabled();
  });

  it('「附帶目前程式碼」以 attachCode 送出', async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByLabelText('向 AI 助教提問'), '檢查一下');
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
