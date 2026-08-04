import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SaveIndicator } from '../../src/components/workspace/SaveIndicator';
import { useSessionStore } from '../../src/store/session';
import { loadTestSession } from '../helpers/store';
import type { SaveState } from '../../src/types';

/**
 * 對應 contracts/ui-contracts.md「保存狀態指示（AnswerWorkspace 標題列）」。
 * 憲章原則 V：狀態變化 MUST 同時以視覺與可存取名稱呈現，MUST NOT 僅依賴顏色。
 */
describe('保存狀態指示（FR-004）', () => {
  beforeEach(() => {
    loadTestSession();
  });

  function renderWith(saveState: SaveState) {
    useSessionStore.getState().setSaveState('q1', saveState);
    return render(<SaveIndicator questionId="q1" />);
  }

  it('idle 顯示「草稿」', () => {
    renderWith('idle');
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('saving 顯示「儲存草稿中…」', () => {
    renderWith('saving');
    expect(screen.getByText('儲存草稿中…')).toBeInTheDocument();
  });

  it('saved 顯示「已自動儲存草稿」', () => {
    renderWith('saved');
    expect(screen.getByText('已自動儲存草稿')).toBeInTheDocument();
  });

  it('error 顯示「儲存失敗，將自動重試」', () => {
    renderWith('error');
    expect(screen.getByText('儲存失敗，將自動重試')).toBeInTheDocument();
  });

  it('saving 與 saved 以 aria-live="polite" 宣告', () => {
    const { unmount } = renderWith('saving');
    expect(screen.getByTestId('save-indicator')).toHaveAttribute('aria-live', 'polite');
    unmount();

    renderWith('saved');
    expect(screen.getByTestId('save-indicator')).toHaveAttribute('aria-live', 'polite');
  });

  it('error 以 aria-live="assertive" 宣告', () => {
    renderWith('error');
    expect(screen.getByTestId('save-indicator')).toHaveAttribute('aria-live', 'assertive');
  });

  it('四種狀態各有可辨識的文字，不只以顏色區分', () => {
    const labels = new Set<string>();
    for (const state of ['idle', 'saving', 'saved', 'error'] as SaveState[]) {
      const { unmount } = renderWith(state);
      labels.add(screen.getByTestId('save-indicator').textContent ?? '');
      unmount();
    }
    expect(labels.size).toBe(4);
  });
});
