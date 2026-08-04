import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSessionStore } from '../../src/store/session';
import {
  SAVE_DEBOUNCE_MS,
  scheduleSave,
  flushPendingSave,
  resetPersistence,
} from '../../src/store/persistence';
import * as api from '../../src/services/api';
import type { SessionPayload } from '../../src/types';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return {
    ...actual,
    saveAnswer: vi.fn(),
    saveAnswersBatch: vi.fn(),
  };
});

const payload: SessionPayload = {
  session: {
    id: 's1',
    candidateName: 'Alex Chen',
    positionTitle: '資深全端工程師模擬面試',
    deadlineAt: new Date(Date.now() + 3600_000).toISOString(),
    status: 'in_progress',
    guidanceMode: 'light',
  },
  questions: [
    {
      id: 'q1',
      title: 'Q1',
      difficulty: 'medium',
      points: 40,
      description: '',
      examples: [],
      complexityRequirement: '',
      gradingFocus: [],
      starterCode: { javascript: 'start q1' },
      quickPrompts: [],
      order: 1,
      testCount: 3,
    },
    {
      id: 'q2',
      title: 'Q2',
      difficulty: 'easy',
      points: 30,
      description: '',
      examples: [],
      complexityRequirement: '',
      gradingFocus: [],
      starterCode: { javascript: 'start q2' },
      quickPrompts: [],
      order: 2,
      testCount: 2,
    },
  ],
  answers: [],
  chat: [],
  serverTime: new Date().toISOString(),
};

describe('草稿保存 debounce（FR-004 / 憲章原則 IV）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPersistence();
    useSessionStore.getState().reset();
    useSessionStore.getState().loadSession(payload);
    vi.mocked(api.saveAnswer).mockResolvedValue({
      savedAt: new Date().toISOString(),
      revision: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('連續輸入 3 秒（每 200ms 一次）只在停止輸入 1000ms 後產生 1 次請求', async () => {
    const store = useSessionStore.getState();

    for (let elapsed = 0; elapsed < 3000; elapsed += 200) {
      store.setDraft('q1', `code-${elapsed}`);
      scheduleSave('q1');
      await vi.advanceTimersByTimeAsync(200);
    }

    // 輸入期間內不得送出任何請求
    expect(api.saveAnswer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    expect(api.saveAnswer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveAnswer).mock.calls[0]?.[0]).toMatchObject({
      questionId: 'q1',
      content: 'code-2800',
    });
  });

  it('debounce 間隔為 1000ms —— 999ms 時尚未送出', async () => {
    useSessionStore.getState().setDraft('q1', 'abc');
    scheduleSave('q1');

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(api.saveAnswer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(api.saveAnswer).toHaveBeenCalledTimes(1);
  });

  it('保存期間狀態指示由 saving 轉為 saved（FR-004）', async () => {
    useSessionStore.getState().setDraft('q1', 'abc');
    scheduleSave('q1');

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(useSessionStore.getState().answers.q1?.saveState).toBe('saved');
    expect(useSessionStore.getState().answers.q1?.dirty).toBe(false);
  });

  it('每次保存的 revision 遞增', async () => {
    vi.mocked(api.saveAnswer).mockImplementation(async (input) => ({
      savedAt: new Date().toISOString(),
      revision: input.revision,
    }));

    useSessionStore.getState().setDraft('q1', 'v1');
    scheduleSave('q1');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    useSessionStore.getState().setDraft('q1', 'v2');
    scheduleSave('q1');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    const calls = vi.mocked(api.saveAnswer).mock.calls;
    expect(calls[0]?.[0].revision).toBe(1);
    expect(calls[1]?.[0].revision).toBe(2);
  });

  it('切換到另一題時，前一題的待保存內容先落地（不會被丟棄）', async () => {
    useSessionStore.getState().setDraft('q1', 'q1-draft');
    scheduleSave('q1');
    await vi.advanceTimersByTimeAsync(300);

    useSessionStore.getState().setDraft('q2', 'q2-draft');
    scheduleSave('q2');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    const saved = vi.mocked(api.saveAnswer).mock.calls.map((c) => c[0].questionId);
    expect(saved).toContain('q1');
    expect(saved).toContain('q2');
  });

  it('保存失敗時狀態轉為 error，且作答內容不被清除（FR-023）', async () => {
    vi.mocked(api.saveAnswer).mockRejectedValue(
      new api.ApiError('INTERNAL_ERROR', '伺服器錯誤', 500)
    );

    useSessionStore.getState().setDraft('q1', 'keep-me');
    scheduleSave('q1');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    expect(useSessionStore.getState().answers.q1?.saveState).toBe('error');
    expect(useSessionStore.getState().answers.q1?.content).toBe('keep-me');
  });
});

describe('flushPendingSave（US3 前置：附帶最新程式碼）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPersistence();
    useSessionStore.getState().reset();
    useSessionStore.getState().loadSession(payload);
    vi.mocked(api.saveAnswer).mockResolvedValue({
      savedAt: new Date().toISOString(),
      revision: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('未等待 debounce 即呼叫時，待保存內容立刻落地', async () => {
    useSessionStore.getState().setDraft('q1', 'not-yet-saved');
    scheduleSave('q1');

    await flushPendingSave();

    expect(api.saveAnswer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveAnswer).mock.calls[0]?.[0].content).toBe('not-yet-saved');
    expect(useSessionStore.getState().answers.q1?.dirty).toBe(false);
  });

  it('沒有待保存內容時不產生請求', async () => {
    await flushPendingSave();
    expect(api.saveAnswer).not.toHaveBeenCalled();
  });

  it('flush 後原本排定的 debounce 計時器不會再送出第二次請求', async () => {
    useSessionStore.getState().setDraft('q1', 'once-only');
    scheduleSave('q1');

    await flushPendingSave();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);

    expect(api.saveAnswer).toHaveBeenCalledTimes(1);
  });
});
