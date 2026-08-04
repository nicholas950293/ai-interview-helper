import * as Tabs from '@radix-ui/react-tabs';
import { useCurrentQuestionId, useQuestions } from '../../store/selectors';
import { switchQuestion } from '../../store/actions';
import type { Difficulty } from '../../types';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '簡單',
  medium: '中等',
  hard: '困難',
};

const DIFFICULTY_CLASSES: Record<Difficulty, string> = {
  easy: 'bg-difficulty-easy-bg text-difficulty-easy-text',
  medium: 'bg-difficulty-medium-bg text-difficulty-medium-text',
  hard: 'bg-difficulty-hard-bg text-difficulty-hard-text',
};

/**
 * 題目頁籤（FR-001）。
 *
 * 用 Radix Tabs 取得方向鍵切換與正確的 ARIA 角色——自行實作是可及性缺陷的常見來源（R-011）。
 * 難度與配分寫進可存取名稱，不只以顏色標示（憲章原則 V）。
 */
export function QuestionTabs() {
  const questions = useQuestions();
  const currentQuestionId = useCurrentQuestionId();

  return (
    <Tabs.Root
      value={currentQuestionId}
      onValueChange={(value) => void switchQuestion(value)}
      activationMode="automatic"
    >
      <Tabs.List aria-label="本場次題目" className="flex gap-1 border-b border-border px-4 pt-3">
        {questions.map((question, index) => (
          <Tabs.Trigger
            key={question.id}
            value={question.id}
            className="flex items-center gap-2 rounded-t-lg border border-transparent px-3 py-2 text-sm text-text-secondary hover:text-text-primary data-[state=active]:border-border data-[state=active]:border-b-surface data-[state=active]:bg-surface data-[state=active]:text-text-primary data-[state=active]:font-medium"
          >
            <span className="font-mono text-xs text-text-muted">Q{index + 1}</span>
            <span>{question.title}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${DIFFICULTY_CLASSES[question.difficulty]}`}
            >
              {DIFFICULTY_LABELS[question.difficulty]}
            </span>
            <span className="text-xs text-text-muted">{question.points} 分</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
