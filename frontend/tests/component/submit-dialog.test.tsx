import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubmitDialog } from '../../src/components/header/SubmitDialog';
import { AnswerWorkspace } from '../../src/components/workspace/AnswerWorkspace';
import { Composer } from '../../src/components/copilot/Composer';
import { useSessionStore } from '../../src/store/session';
import { resetSubmitState } from '../../src/store/actions';
import { loadTestSession } from '../helpers/store';
import * as api from '../../src/services/api';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return { ...actual, submitSession: vi.fn(), saveAnswer: vi.fn(), fetchTime: vi.fn() };
});

/**
 * 提交確認與唯讀鎖定（FR-021 / FR-022）。
 * 提交不可逆，因此「取消」必須真的什麼都不做。
 */
describe('提交確認對話框', () => {
  beforeEach(() => {
    loadTestSession();
    resetSubmitState();
    vi.clearAllMocks();
    vi.mocked(api.submitSession).mockResolvedValue({
      submittedAt: '2026-08-04T01:00:00.000Z',
      status: 'submitted',
    });
  });

  it('點擊「提交全卷」先出現確認對話框，不直接提交', async () => {
    const user = userEvent.setup();
    render(<SubmitDialog />);

    await user.click(screen.getByRole('button', { name: '提交全卷' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.submitSession).not.toHaveBeenCalled();
  });

  it('選擇取消不提交，作答狀態不變（US4 情境 2）', async () => {
    const user = userEvent.setup();
    render(<SubmitDialog />);

    await user.click(screen.getByRole('button', { name: '提交全卷' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(api.submitSession).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session?.status).toBe('in_progress');
  });

  it('確認後提交，狀態轉為 submitted（US4 情境 3）', async () => {
    const user = userEvent.setup();
    render(<SubmitDialog />);

    await user.click(screen.getByRole('button', { name: '提交全卷' }));
    await user.click(screen.getByRole('button', { name: '確認提交' }));

    expect(api.submitSession).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().session?.status).toBe('submitted');
  });

  it('提交不傳送任何作答內容（伺服端取最後保存的草稿）', async () => {
    const user = userEvent.setup();
    render(<SubmitDialog />);

    await user.click(screen.getByRole('button', { name: '提交全卷' }));
    await user.click(screen.getByRole('button', { name: '確認提交' }));

    expect(vi.mocked(api.submitSession).mock.calls[0]).toEqual([]);
  });

  it('對話框說明已作答題數，讓應試者確認前有依據', async () => {
    const user = userEvent.setup();
    useSessionStore.getState().setDraft('q1', '我寫的內容');

    render(<SubmitDialog />);
    await user.click(screen.getByRole('button', { name: '提交全卷' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('3 題中有');
    expect(screen.getByRole('dialog')).toHaveTextContent('1');
  });

  it('場次已是終態時提交按鈕停用', () => {
    useSessionStore.getState().setSessionStatus('submitted');
    render(<SubmitDialog />);

    expect(screen.getByRole('button', { name: '提交全卷' })).toBeDisabled();
  });

  it('提交失敗時保留作答內容，並顯示會持續重試', async () => {
    const user = userEvent.setup();
    vi.mocked(api.submitSession).mockRejectedValue(
      new api.ApiError('NETWORK_OFFLINE', '目前無法連線', 0)
    );
    useSessionStore.getState().setDraft('q1', '不可以被清掉的內容');

    render(<SubmitDialog />);
    await user.click(screen.getByRole('button', { name: '提交全卷' }));
    await user.click(screen.getByRole('button', { name: '確認提交' }));

    expect(useSessionStore.getState().answers.q1?.content).toBe('不可以被清掉的內容');
    expect(useSessionStore.getState().session?.status).toBe('in_progress');
  });
});

describe('終態鎖定所有輸入（FR-022 / 憲章「提交不可逆」）', () => {
  beforeEach(() => {
    loadTestSession();
    resetSubmitState();
    vi.clearAllMocks();
  });

  it('提交後作答區轉為唯讀', () => {
    useSessionStore.getState().setSessionStatus('submitted');
    render(<AnswerWorkspace />);

    expect(screen.getByLabelText('程式語言')).toBeDisabled();
    expect(screen.getByRole('button', { name: '程式碼格式化' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '執行單元測試' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /傳送至 AI 側邊欄/ })).toBeDisabled();
  });

  it('逾時提交同樣鎖定', () => {
    useSessionStore.getState().setSessionStatus('expired_submitted');
    render(<AnswerWorkspace />);

    expect(screen.getByLabelText('程式語言')).toBeDisabled();
  });

  it('AI 側欄的輸入區同時轉為唯讀', () => {
    useSessionStore.getState().setSessionStatus('expired_submitted');
    render(<Composer />);

    expect(screen.getByLabelText('向 AI 助教提問')).toBeDisabled();
    expect(screen.getByLabelText('向 AI 助教提問')).toHaveAttribute(
      'placeholder',
      expect.stringContaining('場次已結束')
    );
  });
});
