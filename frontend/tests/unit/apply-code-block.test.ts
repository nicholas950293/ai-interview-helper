import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSessionStore } from '../../src/store/session';
import { scheduleSave, resetPersistence, SAVE_DEBOUNCE_MS } from '../../src/store/persistence';
import { applyCodeBlock } from '../../src/store/actions';
import * as api from '../../src/services/api';
import { makePayload } from '../helpers/store';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return { ...actual, saveAnswer: vi.fn(), applyCodeBlock: vi.fn() };
});

vi.mock('../../src/components/ui/toast', () => ({ toast: vi.fn() }));

const AI_CODE = 'function solve(items) {\n  return items;\n}\n';

/**
 * 套用 AI 產出（contracts/ui-contracts.md A-05）。
 *
 * 這組測試守的是憲章原則 I 的作者歸屬：套用**必須**經由後端寫入並記為
 * `source='ai'`，而且不能被排程中的草稿保存回頭覆蓋成 candidate。
 * 前端只要有一步走錯，資料庫裡就會多出一筆本人自行輸入的假紀錄。
 */
describe('applyCodeBlock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPersistence();
    useSessionStore.getState().reset();
    useSessionStore.getState().loadSession(makePayload());

    vi.mocked(api.applyCodeBlock).mockResolvedValue({
      content: AI_CODE,
      savedAt: '2026-08-04T01:00:00.000Z',
      revision: 7,
    });
    vi.mocked(api.saveAnswer).mockResolvedValue({
      savedAt: '2026-08-04T00:00:00.000Z',
      revision: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('以 store 的 currentQuestionId 呼叫套用端點，不由呼叫端傳入（憲章原則 II）', async () => {
    useSessionStore.getState().setCurrentQuestion('q2');

    await applyCodeBlock('m-ai', 1);

    expect(api.applyCodeBlock).toHaveBeenCalledWith({
      questionId: 'q2',
      messageId: 'm-ai',
      blockIndex: 1,
    });
  });

  it('成功後以伺服端回傳的內容更新作答，並標記為已保存', async () => {
    await applyCodeBlock('m-ai', 0);

    const answer = useSessionStore.getState().answers.q1!;
    expect(answer.content).toBe(AI_CODE);
    expect(answer.revision).toBe(7);
    expect(answer.savedAt).toBe('2026-08-04T01:00:00.000Z');
    expect(answer.saveState).toBe('saved');
    // dirty 若留成 true，接下來的 debounce 會把同一份內容再送一次並記成
    // candidate——作者歸屬就被抹掉了
    expect(answer.dirty).toBe(false);
  });

  it('取消排程中的草稿保存，MUST NOT 以套用前的內容覆蓋回去（A-05 步驟 5）', async () => {
    useSessionStore.getState().setDraft('q1', '套用前打到一半的內容');
    scheduleSave('q1');

    await applyCodeBlock('m-ai', 0);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);

    expect(api.saveAnswer).not.toHaveBeenCalled();
    expect(useSessionStore.getState().answers.q1!.content).toBe(AI_CODE);
  });

  it('套用期間標記忙碌，結束後清除', async () => {
    let resolveApply: (v: {
      content: string;
      savedAt: string;
      revision: number;
    }) => void = () => {};
    vi.mocked(api.applyCodeBlock).mockReturnValue(
      new Promise((resolve) => {
        resolveApply = resolve;
      })
    );

    const pending = applyCodeBlock('m-ai', 0);
    expect(useSessionStore.getState().applyingBlockKey).toBe('m-ai:0');

    resolveApply({ content: AI_CODE, savedAt: '2026-08-04T01:00:00.000Z', revision: 7 });
    await pending;

    expect(useSessionStore.getState().applyingBlockKey).toBeNull();
  });

  it('套用進行中時忽略第二次點擊，避免兩份內容互相覆蓋', async () => {
    vi.mocked(api.applyCodeBlock).mockReturnValue(new Promise(() => {}));

    void applyCodeBlock('m-ai', 0);
    await applyCodeBlock('m-ai', 1);

    expect(api.applyCodeBlock).toHaveBeenCalledTimes(1);
  });

  it('失敗時 MUST NOT 改動作答內容，且解除忙碌狀態', async () => {
    useSessionStore.getState().setDraft('q1', '我自己寫到一半的內容');
    vi.mocked(api.applyCodeBlock).mockRejectedValue(
      new api.ApiError('BLOCK_NOT_FOUND', '找不到這段程式碼', 404)
    );

    await applyCodeBlock('m-ai', 0);

    expect(useSessionStore.getState().answers.q1!.content).toBe('我自己寫到一半的內容');
    expect(useSessionStore.getState().applyingBlockKey).toBeNull();
  });
});
