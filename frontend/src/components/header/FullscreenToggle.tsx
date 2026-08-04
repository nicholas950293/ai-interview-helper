import { useEffect } from 'react';
import { useFullscreen } from '../../lib/use-fullscreen';
import { syncEnvironmentMonitor } from '../../services/environment-monitor';
import { toast } from '../ui/toast';

const TYPE_LABELS: Record<string, string> = {
  window_blur: '切換到其他視窗',
  tab_hidden: '切換到其他分頁',
};

/**
 * 全螢幕切換與返回提醒（FR-024 / FR-025 / FR-026）。
 *
 * 提醒的用字刻意是事實描述：「離開作答視窗 X 秒，已記錄」——
 * 前端 MUST NOT 呈現作弊判定結論（憲章「防作弊監測」），
 * 判讀留給看得到完整脈絡的面試官。
 */
export function FullscreenToggle() {
  const { isFullscreen, supported, toggle } = useFullscreen();

  // 監測只在全螢幕期間啟用；退出全螢幕即解除監聽。
  useEffect(() => {
    return syncEnvironmentMonitor(isFullscreen, {
      onReturn: ({ type, durationMs }) => {
        toast({
          tone: 'warning',
          title: '已記錄一次離開作答視窗',
          description: `${TYPE_LABELS[type] ?? '離開作答視窗'} 約 ${Math.round(
            durationMs / 1000
          )} 秒。此記錄為客觀事實，供後續評分參考。`,
        });
      },
    });
  }, [isFullscreen]);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={isFullscreen}
      data-testid="fullscreen-toggle"
      title={isFullscreen ? '退出全螢幕（Esc）' : '進入全螢幕'}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-subtle"
    >
      <span aria-hidden="true">{isFullscreen ? '⤡' : '⤢'} </span>
      {isFullscreen ? '退出全螢幕' : '全螢幕'}
    </button>
  );
}
