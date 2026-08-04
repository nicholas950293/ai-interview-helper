import { useCallback } from 'react';
import { useSession } from '../../store/selectors';
import { submitSession } from '../../store/actions';
import { toast } from '../ui/toast';
import { CountdownTimer } from './CountdownTimer';
import { SubmitDialog } from './SubmitDialog';
import { FullscreenToggle } from './FullscreenToggle';
import { KeyboardHelp } from '../KeyboardHelp';

/**
 * Header（FR-032：僅呈現姓名與職稱兩項個資）。
 *
 * 計時歸零時強制提交：中止進行中的 AI 串流 → 鎖定全部輸入 → 提交最後保存的草稿。
 * 鎖定由 `isReadOnly` selector 驅動，狀態一改，三個面板同時轉唯讀（憲章原則 II）。
 */
export function AppHeader() {
  const session = useSession();

  const handleExpire = useCallback(() => {
    toast({
      tone: 'warning',
      title: '時間已到',
      description: '所有輸入已鎖定，系統正在提交你最後一次儲存的草稿。',
    });

    void submitSession({
      forced: true,
      onSuccess: () =>
        toast({
          tone: 'success',
          title: '已完成自動提交',
          description: '提交內容為每一題最後一次成功儲存的草稿。',
        }),
      onError: (message) =>
        toast({
          tone: 'danger',
          title: '自動提交失敗，系統會持續重試',
          description: message,
        }),
    });
  }, []);

  return (
    <div className="flex items-center gap-4 border-b border-border bg-surface px-(--layout-gap) py-3">
      <span className="font-semibold text-text-primary">TechInterview Pro</span>
      <span className="text-sm text-text-secondary">{session?.positionTitle}</span>

      <div className="ml-auto flex items-center gap-4">
        <CountdownTimer onExpire={handleExpire} />
        <span className="text-sm text-text-secondary">{session?.candidateName}</span>
        <KeyboardHelp />
        <FullscreenToggle />
        <SubmitDialog />
      </div>
    </div>
  );
}
