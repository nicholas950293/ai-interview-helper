import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionTabs } from '../../src/components/question/QuestionTabs';
import { useSessionStore } from '../../src/store/session';
import { loadTestSession } from '../helpers/store';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual('../../src/services/api');
  return {
    ...actual,
    saveAnswer: vi.fn().mockResolvedValue({ savedAt: '2026-08-04T00:00:00.000Z', revision: 1 }),
    postChatSystemMessage: vi.fn().mockResolvedValue({
      message: {
        id: 'sys-1',
        questionId: 'q2',
        role: 'system',
        content: '已切換題目',
        createdAt: '2026-08-04T00:00:00.000Z',
        attachedCode: null,
      },
    }),
  };
});

describe('題目頁籤（FR-001 / FR-003）', () => {
  beforeEach(() => {
    loadTestSession();
  });

  it('列出本場次的所有題目，並標示難度與配分', () => {
    render(<QuestionTabs />);

    expect(screen.getByRole('tab', { name: /API 限流器/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /LRU 快取/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /訊息佇列/ })).toBeInTheDocument();

    const first = screen.getByRole('tab', { name: /API 限流器/ });
    expect(first).toHaveAccessibleName(expect.stringContaining('中等'));
    expect(first).toHaveAccessibleName(expect.stringContaining('40 分'));
  });

  it('預設選中第一題', () => {
    render(<QuestionTabs />);
    expect(screen.getByRole('tab', { name: /API 限流器/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('點擊頁籤切換當前題目', async () => {
    const user = userEvent.setup();
    render(<QuestionTabs />);

    await user.click(screen.getByRole('tab', { name: /LRU 快取/ }));

    expect(useSessionStore.getState().currentQuestionId).toBe('q2');
  });

  it('切換題目後再切回，原題目的內容完整保留（FR-003）', async () => {
    const user = userEvent.setup();
    render(<QuestionTabs />);

    useSessionStore.getState().setDraft('q1', 'q1 的作答內容');

    await user.click(screen.getByRole('tab', { name: /LRU 快取/ }));
    useSessionStore.getState().setDraft('q2', 'q2 的作答內容');

    await user.click(screen.getByRole('tab', { name: /API 限流器/ }));

    const answers = useSessionStore.getState().answers;
    expect(answers.q1?.content).toBe('q1 的作答內容');
    expect(answers.q2?.content).toBe('q2 的作答內容');
  });

  it('尚未作答的題目顯示該語言的啟始樣板，不會沿用前一題的內容', async () => {
    const user = userEvent.setup();
    render(<QuestionTabs />);

    useSessionStore.getState().setDraft('q1', '只屬於 q1 的內容');
    await user.click(screen.getByRole('tab', { name: /訊息佇列/ }));

    expect(useSessionStore.getState().answers.q3?.content).toBe('// starter q3');
  });

  it('頁籤可用鍵盤操作（憲章原則 V）', async () => {
    const user = userEvent.setup();
    render(<QuestionTabs />);

    await user.tab();
    expect(screen.getByRole('tab', { name: /API 限流器/ })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(useSessionStore.getState().currentQuestionId).toBe('q2');
  });
});
