import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentUnit } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import type { Language } from '../../types';

/**
 * CodeMirror 6 封裝（FR-007 / R-001）。
 *
 * 介面刻意維持在 value / onChange / language / readOnly——
 * Roadmap Phase 2 換 Monaco 時只替換本檔實作，狀態層不動。
 *
 * 憲章原則 IV：本元件不訂閱 store，輸入只沿 onChange 往上；
 * 題目區與 AI 側欄因此不會隨每次按鍵重繪。
 */
interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  readOnly?: boolean;
  /** 超過此長度時提示應試者（Edge Case：貼上超長內容）。 */
  onOversized?: (bytes: number) => void;
  maxBytes?: number;
}

function languageExtension(language: Language) {
  switch (language) {
    case 'typescript':
      return javascript({ typescript: true });
    case 'python':
      return python();
    case 'go':
      return go();
    case 'javascript':
    default:
      return javascript();
  }
}

const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: '12px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-subtle)',
    color: 'var(--color-text-muted)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-surface-subtle)' },
  '&.cm-focused': { outline: 'none' },
});

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  onOversized,
  maxBytes,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onOversizedRef = useRef(onOversized);

  onChangeRef.current = onChange;
  onOversizedRef.current = onOversized;

  // 建立一次；語言與唯讀狀態之後以 compartment 熱抽換，避免重建整個 EditorState。
  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          indentUnit.of('  '),
          // indentWithTab 置於 defaultKeymap 之前，Tab 才會是縮排而非移動焦點
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          languageCompartment.of(languageExtension(language)),
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          editorTheme,
          EditorView.lineWrapping,
          // 可存取名稱要掛在真正具備 textbox role 的 .cm-content 上，
          // 掛在外層 wrapper 對輔助技術無效（axe: aria-input-field-name）。
          EditorView.contentAttributes.of({
            'aria-label': '程式碼編輯器',
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();

            if (maxBytes !== undefined && new Blob([next]).size > maxBytes) {
              onOversizedRef.current?.(new Blob([next]).size);
            }

            onChangeRef.current(next);
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只在掛載時建立
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部值變更（切換題目、格式化、還原草稿）時同步文件內容。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;

    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartment.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  return <div ref={hostRef} data-testid="code-editor" className="h-full overflow-auto" />;
}
