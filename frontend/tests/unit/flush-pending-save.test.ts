import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSessionStore } from '../../src/store/session';
import { scheduleSave, resetPersistence } from '../../src/store/persistence';
import { sendCodeForReview, switchQuestion } from '../../src/store/actions';
import * as api from '../../src/services/api';
import { makePayload } from '../helpers/store';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return {
    ...actual,
    saveAnswer: vi.fn(),
    saveAnswersBatch: vi.fn(),
    postChat: vi.fn(),
    postChatSystemMessage: vi.fn(),
  };
});

vi.mock('../../src/services/chat-stream', () => ({
  openChatStream: vi.fn(() => ({ abort: vi.fn() })),
}));

/**
 * US3 的前置條件：附帶程式碼或切換題目之前，待保存的變更 MUST 先落地。
 * 否則伺服端取到的是舊草稿，AI 會針對過期的內容回覆——
 * 這類錯誤對應試者不可見，卻直接影響評分公正性（憲章原則 II 的理由）。
 */
describe('flushPendingSave 在跨面板動作前先落地', () => {
  beforeEach(() => {
    resetPersistence();
    useSessionStore.getState().reset();
    useSessionStore.getState().loadSession(makePayload());
    useSessionStore.getState().setConnectivity('online');

    vi.mocked(api.saveAnswer).mockResolvedValue({
      savedAt: '2026-08-04T00:00:00.000Z',
      revision: 1,
    });
    vi.mocked(api.postChat).mockResolvedValue({ streamId: 's1', messageId: 'm1' });
    vi.mocked(api.postChatSystemMessage).mockResolvedValue({
      message: {
        id: 'sys-1',
        questionId: 'q2',
        role: 'system',
        content: '已切換至 Q2',
        createdAt: '2026-08-04T00:00:00.000Z',
        attachedCode: null,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('「傳送至 AI 側邊欄」會先保存，才呼叫 POST /api/chat（ui-contracts A-03）', async () => {
    const order: string[] = [];
    vi.mocked(api.saveAnswer).mockImplementation(async () => {
      order.push('save');
      return { savedAt: '2026-08-04T00:00:00.000Z', revision: 1 };
    });
    vi.mocked(api.postChat).mockImplementation(async () => {
      order.push('chat');
      return { streamId: 's1', messageId: 'm1' };
    });

    useSessionStore.getState().setDraft('q1', '剛剛才輸入、尚未保存的內容');
    scheduleSave('q1');

    await sendCodeForReview();

    expect(order).toEqual(['save', 'chat']);
    expect(vi.mocked(api.saveAnswer).mock.calls[0]?.[0].content).toBe('剛剛才輸入、尚未保存的內容');
    expect(vi.mocked(api.postChat).mock.calls[0]?.[0].attachCode).toBe(true);
  });

  it('送出的 questionId 來自 store，不由呼叫端傳入', async () => {
    useSessionStore.getState().setCurrentQuestion('q2');
    await sendCodeForReview();

    expect(vi.mocked(api.postChat).mock.calls[0]?.[0].questionId).toBe('q2');
  });

  it('離線導致 flush 失敗時阻擋送出，MUST NOT 以舊草稿充當 Context', async () => {
    vi.mocked(api.saveAnswer).mockRejectedValue(new api.ApiError('NETWORK_OFFLINE', '離線', 0));

    useSessionStore.getState().setDraft('q1', '離線時輸入的內容');
    scheduleSave('q1');

    await sendCodeForReview();

    expect(api.postChat).not.toHaveBeenCalled();
    const chat = useSessionStore.getState().chat;
    expect(chat.at(-1)?.role).toBe('system');
    expect(chat.at(-1)?.content).toContain('離線');
  });

  it('切換題目時先保存前一題（ui-contracts A-01 步驟 1）', async () => {
    useSessionStore.getState().setDraft('q1', 'q1 尚未保存的內容');
    scheduleSave('q1');

    await switchQuestion('q2');

    expect(vi.mocked(api.saveAnswer).mock.calls[0]?.[0]).toMatchObject({
      questionId: 'q1',
      content: 'q1 尚未保存的內容',
    });
    expect(useSessionStore.getState().currentQuestionId).toBe('q2');
  });

  it('沒有待保存內容時，跨面板動作不產生多餘的保存請求', async () => {
    await sendCodeForReview();
    expect(api.saveAnswer).not.toHaveBeenCalled();
  });
});
