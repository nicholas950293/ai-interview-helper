import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullscreen } from '../../src/lib/use-fullscreen';

/**
 * 全螢幕狀態同步（FR-024 / US5 情境 1）。
 *
 * 按鈕狀態 MUST 依實際全螢幕狀態同步——包含以 Esc 退出這種不經過按鈕的路徑。
 */
describe('全螢幕切換', () => {
  let fullscreenElement: Element | null = null;

  function fireChange() {
    document.dispatchEvent(new Event('fullscreenchange'));
  }

  beforeEach(() => {
    fullscreenElement = null;

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });

    document.documentElement.requestFullscreen = vi.fn(async () => {
      fullscreenElement = document.documentElement;
      fireChange();
    });

    document.exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      fireChange();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初始狀態為非全螢幕', () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);
  });

  it('toggle 進入全螢幕後狀態同步為 true', async () => {
    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      await result.current.toggle();
    });

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    expect(result.current.isFullscreen).toBe(true);
  });

  it('再次 toggle 退出全螢幕', async () => {
    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      await result.current.toggle();
    });
    await act(async () => {
      await result.current.toggle();
    });

    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(result.current.isFullscreen).toBe(false);
  });

  it('以 Esc 退出（不經過按鈕）時狀態同樣同步', async () => {
    const { result } = renderHook(() => useFullscreen());

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.isFullscreen).toBe(true);

    // 瀏覽器自行退出：只有 fullscreenchange，沒有我們的呼叫
    act(() => {
      fullscreenElement = null;
      fireChange();
    });

    expect(result.current.isFullscreen).toBe(false);
  });

  it('瀏覽器拒絕請求時不做樂觀更新，狀態維持 false', async () => {
    document.documentElement.requestFullscreen = vi.fn(async () => {
      throw new Error('permission denied');
    });

    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.isFullscreen).toBe(false);
  });

  it('卸載後移除監聽，不再更新狀態', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useFullscreen());

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
  });
});
