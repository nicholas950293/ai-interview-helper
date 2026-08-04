import * as prettier from 'prettier/standalone';
import babelPlugin from 'prettier/plugins/babel';
import estreePlugin from 'prettier/plugins/estree';
import typescriptPlugin from 'prettier/plugins/typescript';
import type { Language } from '../types';

/**
 * 程式碼格式化（FR-006 / R-010）。
 *
 * JS / TS 以 Prettier standalone 在瀏覽器端完成，不需後端往返。
 * Python / Go 本期只做縮排正規化——完整格式化器（black、gofmt）需要語言執行環境，
 * 屬 Roadmap Phase 3 的沙盒範圍，不得提前混入（憲章「開發流程與品質關卡」）。
 */
export interface FormatResult {
  ok: boolean;
  /** 失敗時等於原內容——格式化 MUST NOT 破壞應試者已寫的東西。 */
  code: string;
  message: string;
}

const PRETTIER_PARSERS: Partial<Record<Language, string>> = {
  javascript: 'babel',
  typescript: 'typescript',
};

/** Python / Go：統一縮排寬度、去除行尾空白、把連續空行壓到兩行以內。 */
function normalizeIndentation(source: string, indentUnit: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  const normalized = lines.map((line) => {
    const trimmedEnd = line.replace(/\s+$/, '');
    if (trimmedEnd.length === 0) return '';

    const match = /^[\t ]*/.exec(trimmedEnd);
    const leading = match?.[0] ?? '';
    const body = trimmedEnd.slice(leading.length);

    // Tab 視為一級縮排；空白以 4 格為一級（Python 慣例，Go 之後會轉回 Tab）。
    const tabCount = (leading.match(/\t/g) ?? []).length;
    const spaceCount = leading.length - tabCount;
    const level = tabCount + Math.floor(spaceCount / 4);

    return indentUnit.repeat(level) + body;
  });

  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of normalized) {
    if (line === '') {
      blankRun += 1;
      if (blankRun > 2) continue;
    } else {
      blankRun = 0;
    }
    collapsed.push(line);
  }

  return `${collapsed.join('\n').replace(/\n+$/, '')}\n`;
}

export async function formatCode(source: string, language: Language): Promise<FormatResult> {
  if (source.trim().length === 0) {
    return { ok: true, code: source, message: '內容為空，無須格式化。' };
  }

  const parser = PRETTIER_PARSERS[language];

  if (parser) {
    try {
      const formatted = await prettier.format(source, {
        parser,
        plugins: [babelPlugin, estreePlugin, typescriptPlugin],
        singleQuote: true,
        semi: true,
        tabWidth: 2,
      });
      return { ok: true, code: formatted, message: '已重新排版。' };
    } catch {
      // 語法錯誤時保留原內容（FR-006：失敗時顯示提示且不破壞原內容）
      return {
        ok: false,
        code: source,
        message: '程式碼目前無法解析，已保留原內容。修正語法後可再試一次。',
      };
    }
  }

  const indentUnit = language === 'go' ? '\t' : '    ';
  return {
    ok: true,
    code: normalizeIndentation(source, indentUnit),
    message:
      language === 'go'
        ? '已正規化縮排（本期不含 gofmt 的完整排版）。'
        : '已正規化縮排（本期不含 black 的完整排版）。',
  };
}
