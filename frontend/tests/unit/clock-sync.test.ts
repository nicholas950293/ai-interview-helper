import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionStore } from '../../src/store/session';
import { useCountdown, CLOCK_SYNC_INTERVAL_MS } from '../../src/lib/use-countdown';
import * as api from '../../src/services/api';
import { makePayload } from '../helpers/store';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return { ...actual, fetchTime: vi.fn() };
});

/**
 * 時鐘校時與漂移修正（R-007）。
 *
 * 前端每秒本地遞減保證顯示流暢，每 30 秒與伺服端校時修正漂移；
 * 伺服端二次驗證使前端時鐘竄改無效。
 */
describe('週期校時', () => {
  const deadline = new Date(Date.now() + 600_000).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    useSessionStore.getState().reset();
    useSessionStore.getState().loadSession({
      ...makePayload(),
      session: {
        id: 's1',
        candidateName: 'Alex Chen',
        positionTitle: '模擬面試',
        deadlineAt: deadline,
        status: 'in_progress',
        guidanceMode: 'light',
      },
    });
    vi.mocked(api.fetchTime).mockResolvedValue({
      serverTime: new Date().toISOString(),
      deadlineAt: deadline,
      status: 'in_progress',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('每 30 秒呼叫一次 GET /api/time', async () => {
    renderHook(() => useCountdown());

    expect(api.fetchTime).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS);
    expect(api.fetchTime).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS);
    expect(api.fetchTime).toHaveBeenCalledTimes(2);
  });

  it('校時回應更新 clockOffsetMs', async () => {
    // 伺服端時間比本地快 20 秒。serverTime 必須在呼叫當下計算——
    // 假時鐘會推進 30 秒，先算好的時間戳到了校時當下已經是「過去」。
    vi.mocked(api.fetchTime).mockImplementation(async () => ({
      serverTime: new Date(Date.now() + 20_000).toISOString(),
      deadlineAt: deadline,
      status: 'in_progress' as const,
    }));

    renderHook(() => useCountdown());
    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS);

    expect(useSessionStore.getState().clockOffsetMs).toBeGreaterThan(19_000);
  });

  it('伺服端回報逾時提交時，前端狀態同步轉為終態', async () => {
    vi.mocked(api.fetchTime).mockResolvedValue({
      serverTime: new Date().toISOString(),
      deadlineAt: deadline,
      status: 'expired_submitted',
    });

    renderHook(() => useCountdown());
    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS);

    expect(useSessionStore.getState().session?.status).toBe('expired_submitted');
  });

  it('校時失敗不影響本地顯示，下一輪再試', async () => {
    vi.mocked(api.fetchTime).mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useCountdown());
    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS);

    expect(result.current.remainingSec).toBeGreaterThan(0);

    vi.mocked(api.fetchTime).mockResolvedValue({
      serverTime: new Date().toISOString(),
      deadlineAt: deadline,
      status: 'in_progress',
    });
    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_INTERVAL_MS);
    expect(api.fetchTime).toHaveBeenCalledTimes(2);
  });
});

describe('歸零回呼', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSessionStore.getState().reset();
    vi.mocked(api.fetchTime).mockResolvedValue({
      serverTime: new Date().toISOString(),
      deadlineAt: null,
      status: 'in_progress',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('計時歸零時觸發一次 onExpire，且不重複觸發', async () => {
    useSessionStore.getState().loadSession({
      ...makePayload(),
      session: {
        id: 's1',
        candidateName: 'Alex Chen',
        positionTitle: '模擬面試',
        deadlineAt: new Date(Date.now() + 3000).toISOString(),
        status: 'in_progress',
        guidanceMode: 'light',
      },
    });

    const onExpire = vi.fn();
    renderHook(() => useCountdown(onExpire));

    await vi.advanceTimersByTimeAsync(2000);
    expect(onExpire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(onExpire).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('尚未取得 deadlineAt 時不觸發 onExpire', async () => {
    const onExpire = vi.fn();
    renderHook(() => useCountdown(onExpire));

    await vi.advanceTimersByTimeAsync(5000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
