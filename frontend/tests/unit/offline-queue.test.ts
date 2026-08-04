import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enqueueSave,
  readQueue,
  clearQueue,
  flushQueue,
  resetPersistence,
} from '../../src/store/persistence';
import * as api from '../../src/services/api';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return { ...actual, saveAnswer: vi.fn(), saveAnswersBatch: vi.fn() };
});

describe('離線草稿佇列（FR-028 / R-008）', () => {
  beforeEach(async () => {
    resetPersistence();
    await clearQueue();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await clearQueue();
  });

  it('離線期間的變更累積於佇列，不遺失', async () => {
    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'a', revision: 1 });
    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'b', revision: 2 });
    await enqueueSave({ questionId: 'q2', language: 'python', content: 'c', revision: 1 });

    const queued = await readQueue();
    expect(queued).toHaveLength(3);
  });

  it('讀取時依 revision 排序，確保補送順序正確', async () => {
    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'v3', revision: 3 });
    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'v1', revision: 1 });
    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'v2', revision: 2 });

    const queued = await readQueue();
    expect(queued.map((q) => q.revision)).toEqual([1, 2, 3]);
  });

  it('恢復連線後批次補送，成功則清空佇列', async () => {
    vi.mocked(api.saveAnswersBatch).mockResolvedValue({
      saved: [
        { questionId: 'q1', savedAt: '2026-08-04T00:00:00.000Z', revision: 2 },
        { questionId: 'q2', savedAt: '2026-08-04T00:00:00.000Z', revision: 1 },
      ],
    });

    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'b', revision: 2 });
    await enqueueSave({ questionId: 'q2', language: 'python', content: 'c', revision: 1 });

    await flushQueue();

    expect(api.saveAnswersBatch).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(api.saveAnswersBatch).mock.calls[0]?.[0] ?? [];
    expect(sent.map((s) => s.revision)).toEqual([1, 2]);
    expect(await readQueue()).toHaveLength(0);
  });

  it('補送失敗時佇列保留，內容 MUST NOT 被丟棄（FR-023）', async () => {
    vi.mocked(api.saveAnswersBatch).mockRejectedValue(
      new api.ApiError('NETWORK_OFFLINE', '離線', 0)
    );

    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'keep', revision: 1 });
    await flushQueue();

    const queued = await readQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.content).toBe('keep');
  });

  it('佇列為空時不發出請求', async () => {
    await flushQueue();
    expect(api.saveAnswersBatch).not.toHaveBeenCalled();
  });

  it('同一題的多次變更皆保留，由伺服端依 revision 決定最終內容', async () => {
    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'old', revision: 1 });
    await enqueueSave({ questionId: 'q1', language: 'javascript', content: 'new', revision: 2 });

    const queued = await readQueue();
    expect(queued.at(-1)?.content).toBe('new');
  });
});
