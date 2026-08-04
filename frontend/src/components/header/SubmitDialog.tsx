import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useIsReadOnly, useQuestions } from '../../store/selectors';
import { useSessionStore } from '../../store/session';
import { submitSession } from '../../store/actions';
import { toast } from '../ui/toast';

/**
 * 提交確認對話框與提交成功提示（FR-021）。
 *
 * 提交不可逆，因此手動提交前 MUST 先確認；取消時不提交、作答狀態不變。
 * 成功提示同時具備視覺與可存取名稱（憲章原則 V）。
 */
export function SubmitDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const readOnly = useIsReadOnly();
  const questions = useQuestions();
  const answers = useSessionStore((s) => s.answers);

  const answered = questions.filter((q) => {
    const answer = answers[q.id];
    if (!answer) return false;
    const starter = q.starterCode[answer.language] ?? '';
    return answer.content.trim().length > 0 && answer.content.trim() !== starter.trim();
  }).length;

  const handleConfirm = async () => {
    setSubmitting(true);
    await submitSession({
      onSuccess: () => {
        setSubmitting(false);
        setOpen(false);
        toast({
          tone: 'success',
          title: '已成功提交全卷',
          description: '你的作答已送出，所有作答區已轉為唯讀。感謝你的參與。',
        });
      },
      onError: (message) => {
        setSubmitting(false);
        toast({
          tone: 'danger',
          title: '提交失敗，系統會持續重試',
          description: message,
        });
      },
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={readOnly}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm text-text-inverse hover:bg-accent-hover disabled:opacity-60"
        >
          提交全卷
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20" />
        <Dialog.Content className="card fixed top-1/2 left-1/2 w-[30rem] -translate-x-1/2 -translate-y-1/2 p-6">
          <Dialog.Title className="text-base font-semibold text-text-primary">
            確定要提交全卷嗎？
          </Dialog.Title>
          <Dialog.Description className="mt-3 text-sm text-text-secondary">
            提交後所有作答區會轉為唯讀，無法再修改。目前 {questions.length} 題中有{' '}
            <strong className="text-text-primary">{answered}</strong> 題已作答。
            提交的內容是每一題最後一次成功儲存的草稿。
          </Dialog.Description>

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-surface-subtle"
              >
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={submitting}
              aria-busy={submitting}
              onClick={() => void handleConfirm()}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-text-inverse hover:bg-accent-hover disabled:opacity-60"
            >
              {submitting ? '提交中…' : '確認提交'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
