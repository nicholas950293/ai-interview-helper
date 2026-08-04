import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  startEnvironmentMonitor,
  syncEnvironmentMonitor,
  MIN_DURATION_MS,
} from '../../src/services/environment-monitor';
import { useSessionStore } from '../../src/store/session';
import { clearEnvironmentQueue, readEnvironmentQueue } from '../../src/store/persistence';
import { loadTestSession } from '../helpers/store';
import type { EnvironmentEventType } from '../../src/types';
import type * as api from '../../src/services/api';

vi.mock('../../src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/services/api');
  return { ...actual, postEnvironmentEvents: vi.fn().mockResolvedValue({ accepted: 1 }) };
});

/**
 * 等待 IndexedDB 的非同步寫入落地。
 *
 * 單純 await 一個 tick 不夠——idb 的 add() 會跨多個 microtask，
 * 因此輪詢到佇列長度符合預期為止。
 */
async function expectQueueLength(n: number) {
  // 回傳 waitFor 當下讀到的那一份，重新再讀一次會與其他測試的清理競態。
  let snapshot: Awaited<ReturnType<typeof readEnvironmentQueue>> = [];
  await waitFor(async () => {
    snapshot = await readEnvironmentQueue();
    expect(snapshot).toHaveLength(n);
  });
  return snapshot;
}

/** 讓事件處理鏈上的 promise 有機會執行。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * 環境事件門檻與記錄內容（FR-025 / FR-026 / R-012）。
 *
 * 1000ms 門檻濾掉焦點瞬時抖動（如 Toast 出現）造成的誤報——
 * 誤報過多反而干擾應試者，也讓記錄失去參考價值。
 */
describe('環境事件門檻', () => {
  let stop: (() => void) | undefined;
  let onReturn: Mock<(event: { type: EnvironmentEventType; durationMs: number }) => void>;

  beforeEach(async () => {
    // 只假造 Date：fake-indexeddb 依賴真實的 microtask 排程，
    // 完整假時鐘會讓所有 IndexedDB 操作永遠不 resolve。
    vi.useFakeTimers({ toFake: ['Date'] });
    loadTestSession();
    await clearEnvironmentQueue();
    onReturn = vi.fn();
    stop = startEnvironmentMonitor({ onReturn });
    setVisibility('visible');
  });

  afterEach(async () => {
    stop?.();
    vi.useRealTimers();
    await clearEnvironmentQueue();
    vi.clearAllMocks();
  });

  it('離開少於 1000ms 不記錄，也不提醒', async () => {
    setVisibility('hidden');
    vi.advanceTimersByTime(MIN_DURATION_MS - 1);
    setVisibility('visible');
    await settle();

    expect(onReturn).not.toHaveBeenCalled();
    expect(await readEnvironmentQueue()).toHaveLength(0);
  });

  it('離開達 1000ms 即記錄並提醒', async () => {
    setVisibility('hidden');
    vi.advanceTimersByTime(MIN_DURATION_MS);
    setVisibility('visible');
    await settle();

    expect(onReturn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tab_hidden', durationMs: expect.any(Number) })
    );
  });

  it('記錄含類型、起始時間與持續長度（US5 情境 2）', async () => {
    setVisibility('hidden');
    vi.advanceTimersByTime(2500);
    setVisibility('visible');
    await settle();

    const queued = await expectQueueLength(1);
    expect(queued[0]).toMatchObject({ type: 'tab_hidden', durationMs: 2500 });
    expect(queued[0]?.startedAt).toBeTruthy();
  });

  it('window blur 同樣被記錄（涵蓋切換到其他應用程式）', async () => {
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(3000);
    window.dispatchEvent(new Event('focus'));
    await settle();

    const queued = await expectQueueLength(1);
    expect(queued[0]?.type).toBe('window_blur');
  });

  it('blur 與 visibilitychange 同時觸發時只記錄一次', async () => {
    window.dispatchEvent(new Event('blur'));
    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');
    window.dispatchEvent(new Event('focus'));
    await settle();

    await expectQueueLength(1);
  });

  it('多次切換各自記錄（US5 情境 3）', async () => {
    for (let i = 0; i < 3; i += 1) {
      setVisibility('hidden');
      vi.advanceTimersByTime(1500);
      setVisibility('visible');
      await settle();
    }

    expect(onReturn).toHaveBeenCalledTimes(3);
  });

  it('記錄不含任何判定性欄位（FR-026）', async () => {
    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');
    await settle();

    const queued = await expectQueueLength(1);
    expect(Object.keys(queued[0] ?? {}).sort()).toEqual(['durationMs', 'id', 'startedAt', 'type']);
  });

  it('停止監測後不再記錄', async () => {
    stop?.();
    stop = undefined;

    setVisibility('hidden');
    vi.advanceTimersByTime(3000);
    setVisibility('visible');
    await settle();

    expect(onReturn).not.toHaveBeenCalled();
  });
});

/**
 * 憲章「防作弊監測」明定監聽只在全螢幕模式下進行；
 * 非全螢幕時記錄等於在應試者未被告知的情況下蒐集行為。
 */
describe('監測僅於全螢幕期間啟用', () => {
  beforeEach(() => {
    loadTestSession();
  });

  it('非全螢幕時不啟動監測', () => {
    expect(syncEnvironmentMonitor(false, { onReturn: vi.fn() })).toBeUndefined();
  });

  it('全螢幕且場次進行中時啟動監測', () => {
    const stop = syncEnvironmentMonitor(true, { onReturn: vi.fn() });
    expect(typeof stop).toBe('function');
    stop?.();
  });

  it('場次已進入終態時不啟動監測', () => {
    useSessionStore.getState().setSessionStatus('submitted');
    expect(syncEnvironmentMonitor(true, { onReturn: vi.fn() })).toBeUndefined();
  });
});
