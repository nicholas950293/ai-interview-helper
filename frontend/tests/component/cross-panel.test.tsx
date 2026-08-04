import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskAiButton } from '../../src/components/question/AskAiButton';
import { SendToAiButton } from '../../src/components/workspace/SendToAiButton';
import { StatusBar } from '../../src/components/copilot/StatusBar';
import { QuickPromptChips } from '../../src/components/copilot/QuickPromptChips';
import { useSessionStore } from '../../src/store/session';
import { loadTestSession, makeQuestion } from '../helpers/store';
import * as api from '../../src/services/api';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return {
    ...actual,
    saveAnswer: vi.fn().mockResolvedValue({ savedAt: '2026-08-04T00:00:00.000Z', revision: 1 }),
    postChat: vi.fn().mockResolvedValue({ streamId: 's1', messageId: 'm1' }),
    postChatSystemMessage: vi.fn().mockResolvedValue({
      message: {
        id: 'sys-1',
        questionId: 'q2',
        role: 'system',
        content: '已切換至 Q2',
        createdAt: '2026-08-04T00:00:00.000Z',
        attachedCode: null,
      },
    }),
  };
});

vi.mock('../../src/services/chat-stream', () => ({
  openChatStream: vi.fn(() => ({ abort: vi.fn() })),
}));

/**
 * 憲章原則 II 的可驗收面：跨組件動作 MUST 從 store 讀取 Context，
 * MUST NOT 各自複製一份快照。停留在 Q2 時送出的 questionId 就必須是 Q2。
 */
describe('跨面板 Context 聯動（FR-016 ~ FR-019）', () => {
  beforeEach(() => {
    loadTestSession();
    useSessionStore.getState().setConnectivity('online');
    vi.clearAllMocks();
  });

  it('停留在 Q2 時「詢問 AI 題目重點」送出的 questionId 為 Q2（US3 情境 1）', async () => {
    const user = userEvent.setup();
    useSessionStore.getState().setCurrentQuestion('q2');

    render(<AskAiButton />);
    await user.click(screen.getByRole('button', { name: /詢問 AI 題目重點/ }));

    expect(vi.mocked(api.postChat).mock.calls[0]?.[0]).toMatchObject({
      questionId: 'q2',
      source: 'question_hint',
      attachCode: false,
    });
  });

  it('「傳送至 AI 側邊欄」以 attachCode 送出當前題目（US3 情境 2）', async () => {
    const user = userEvent.setup();
    useSessionStore.getState().setCurrentQuestion('q3');

    render(<SendToAiButton />);
    await user.click(screen.getByRole('button', { name: /傳送至 AI 側邊欄/ }));

    expect(vi.mocked(api.postChat).mock.calls[0]?.[0]).toMatchObject({
      questionId: 'q3',
      source: 'code_review',
      attachCode: true,
    });
  });

  it('In-Context 狀態列訂閱 currentQuestion，切題後自動更新（US3 情境 3）', () => {
    const { rerender } = render(<StatusBar />);
    expect(screen.getByTestId('in-context-status')).toHaveTextContent('Q1・API 限流器');

    useSessionStore.getState().setCurrentQuestion('q3');
    rerender(<StatusBar />);

    expect(screen.getByTestId('in-context-status')).toHaveTextContent('Q3・訊息佇列');
  });

  it('狀態列以 aria-live 宣告題目變更，不只用視覺呈現', () => {
    render(<StatusBar />);
    expect(screen.getByTestId('in-context-status')).toHaveAttribute('aria-live', 'polite');
  });

  it('快捷提問 Chips 隨當前題目變動（ui-contracts A-04）', () => {
    loadTestSession({
      questions: [
        makeQuestion({ id: 'q1', order: 1, quickPrompts: ['Q1 專屬提問'] }),
        makeQuestion({ id: 'q2', order: 2, quickPrompts: ['Q2 專屬提問'] }),
      ],
    });

    const { rerender } = render(<QuickPromptChips />);
    expect(screen.getByRole('button', { name: 'Q1 專屬提問' })).toBeInTheDocument();

    useSessionStore.getState().setCurrentQuestion('q2');
    rerender(<QuickPromptChips />);

    expect(screen.getByRole('button', { name: 'Q2 專屬提問' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Q1 專屬提問' })).not.toBeInTheDocument();
  });

  it('串流期間兩個聯動按鈕皆停用，避免重複送出', () => {
    useSessionStore.getState().setStreaming({ active: true, messageId: 'm1' });

    render(
      <>
        <AskAiButton />
        <SendToAiButton />
      </>
    );

    expect(screen.getByRole('button', { name: /詢問 AI 題目重點/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /傳送至 AI 側邊欄/ })).toBeDisabled();
  });

  it('場次結束後兩個聯動按鈕皆停用', () => {
    useSessionStore.getState().setSessionStatus('submitted');

    render(
      <>
        <AskAiButton />
        <SendToAiButton />
      </>
    );

    expect(screen.getByRole('button', { name: /詢問 AI 題目重點/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /傳送至 AI 側邊欄/ })).toBeDisabled();
  });
});
