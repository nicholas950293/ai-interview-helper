import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSessionStore } from '../../store/session';
import { scheduleSave } from '../../store/persistence';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type Language, type Question } from '../../types';

/**
 * 語言選單（FR-005）。
 *
 * 切換語言且該題已有內容時 MUST 先徵詢是否以新語言的 starter code 取代；
 * 取消則保留原內容——直接覆寫等於在應試者不知情下刪掉他的作答。
 */
interface LanguageSelectProps {
  question: Question;
  language: Language;
  content: string;
  disabled?: boolean;
}

function isUntouched(content: string, question: Question, language: Language): boolean {
  const starter = question.starterCode[language] ?? '';
  return content.trim().length === 0 || content.trim() === starter.trim();
}

export function LanguageSelect({ question, language, content, disabled }: LanguageSelectProps) {
  const setLanguage = useSessionStore((s) => s.setLanguage);
  const [candidate, setCandidate] = useState<Language | null>(null);

  const applyLanguage = (next: Language, replaceWithStarter: boolean) => {
    const starter = question.starterCode[next] ?? '';
    setLanguage(question.id, next, replaceWithStarter ? starter : undefined);
    scheduleSave(question.id);
  };

  const handleChange = (next: Language) => {
    if (next === language) return;

    // 尚未動過的內容直接換樣板，不打擾應試者
    if (isUntouched(content, question, language)) {
      applyLanguage(next, true);
      return;
    }

    setCandidate(next);
  };

  return (
    <>
      <label className="inline-flex items-center gap-2 text-sm">
        <span className="text-text-secondary">語言</span>
        <select
          aria-label="程式語言"
          value={language}
          disabled={disabled}
          onChange={(e) => handleChange(e.target.value as Language)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-text-primary disabled:opacity-60"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_LABELS[lang]}
            </option>
          ))}
        </select>
      </label>

      <Dialog.Root open={candidate !== null} onOpenChange={(open) => !open && setCandidate(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/20" />
          <Dialog.Content className="card fixed top-1/2 left-1/2 w-[28rem] -translate-x-1/2 -translate-y-1/2 p-6">
            <Dialog.Title className="text-base font-semibold text-text-primary">
              要以 {candidate ? LANGUAGE_LABELS[candidate] : ''} 的啟始樣板取代現有內容嗎？
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-sm text-text-secondary">
              這一題目前已有作答內容。選擇「取代」會以新語言的啟始樣板覆蓋，
              選擇「保留現有內容」則只切換語言，程式碼不變。
            </Dialog.Description>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-surface-subtle"
                onClick={() => {
                  if (candidate) applyLanguage(candidate, false);
                  setCandidate(null);
                }}
              >
                保留現有內容
              </button>
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-2 text-sm text-text-inverse hover:bg-accent-hover"
                onClick={() => {
                  if (candidate) applyLanguage(candidate, true);
                  setCandidate(null);
                }}
              >
                取代為啟始樣板
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
