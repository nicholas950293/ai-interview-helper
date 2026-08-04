import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { flushPendingSave } from '../store/persistence';

/**
 * 全域鍵盤快捷鍵與可見說明（contracts/ui-contracts.md「鍵盤契約」）。
 *
 * 憲章原則 V：所有快捷鍵 MUST 於介面上有可見說明——
 * 只有知道的人能用的快捷鍵，對其他人就是不存在的功能。
 */
const SHORTCUTS: { keys: string; action: string; where: string }[] = [
  { keys: 'Ctrl / ⌘ + Enter', action: '送出提問', where: 'AI 側欄輸入區' },
  { keys: 'Tab / Shift + Tab', action: '縮排／反縮排', where: '程式碼編輯器' },
  { keys: 'Ctrl / ⌘ + S', action: '立即儲存草稿', where: '全域' },
  { keys: 'Esc', action: '關閉對話框；退出全螢幕', where: '全域' },
  { keys: 'Ctrl / ⌘ + /', action: '開啟本說明', where: '全域' },
];

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      if (!meta) return;

      // Ctrl/⌘ + S：攔截瀏覽器的「儲存網頁」，改為立即保存草稿
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushPendingSave();
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="鍵盤快捷鍵說明"
          title="鍵盤快捷鍵說明（Ctrl + /）"
          className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
        >
          <span aria-hidden="true">⌨</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20" />
        <Dialog.Content className="card fixed top-1/2 left-1/2 w-[32rem] -translate-x-1/2 -translate-y-1/2 p-6">
          <Dialog.Title className="text-base font-semibold text-text-primary">
            鍵盤快捷鍵
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-text-secondary">
            核心流程——閱讀題目、作答、提問、提交——都可以全鍵盤完成。
          </Dialog.Description>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th className="py-2 font-medium">快捷鍵</th>
                <th className="py-2 font-medium">作用</th>
                <th className="py-2 font-medium">位置</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.keys} className="border-b border-border last:border-0">
                  <td className="py-2">
                    <kbd className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-xs text-text-primary">
                      {shortcut.keys}
                    </kbd>
                  </td>
                  <td className="py-2 text-text-secondary">{shortcut.action}</td>
                  <td className="py-2 text-text-muted">{shortcut.where}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-surface-subtle"
              >
                關閉
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
