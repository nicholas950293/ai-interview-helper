import * as ToastPrimitive from '@radix-ui/react-toast';
import { create } from 'zustand';

/**
 * 全域 Toast（保存／測試／格式化提示）。
 *
 * Radix Toast 提供 live region 與焦點行為；憲章原則 V 要求狀態變化
 * MUST 同時以視覺與可存取名稱呈現，因此每則提示都有明確文字，圖示僅為輔助。
 */
export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastStore {
  items: ToastItem[];
  push: (item: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastStore>((set, get) => ({
  items: [],
  push: (item) => set({ items: [...get().items, { ...item, id: nextId++ }] }),
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));

export function toast(item: Omit<ToastItem, 'id'>): void {
  useToastStore.getState().push(item);
}

const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'border-success text-success-text',
  warning: 'border-warning text-warning-text',
  danger: 'border-danger text-danger-text',
  info: 'border-border text-text-primary',
};

const TONE_ICONS: Record<ToastTone, string> = {
  success: '✅',
  warning: '⚠️',
  danger: '⛔',
  info: 'ℹ️',
};

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
      {items.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          open
          onOpenChange={(open) => !open && dismiss(item.id)}
          className={`card flex items-start gap-3 border-l-4 p-4 ${TONE_CLASSES[item.tone]}`}
        >
          <span aria-hidden="true">{TONE_ICONS[item.tone]}</span>
          <div className="min-w-0">
            <ToastPrimitive.Title className="text-sm font-medium">
              {item.title}
            </ToastPrimitive.Title>
            {item.description && (
              <ToastPrimitive.Description className="mt-1 text-sm text-text-secondary">
                {item.description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close
            aria-label="關閉提示"
            className="ml-auto shrink-0 text-text-muted hover:text-text-primary"
          >
            ✕
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
