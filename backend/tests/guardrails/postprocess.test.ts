import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyGuardrail, inspectResponse, GUARDRAIL_REFUSAL } from '../../src/ai/postprocess.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

interface RecordedResponse {
  id: string;
  note: string;
  text: string;
}

const recorded = JSON.parse(readFileSync(join(FIXTURES, 'recorded-responses.json'), 'utf8')) as {
  violating: RecordedResponse[];
  compliant: RecordedResponse[];
};

/**
 * 憲章原則 I（NON-NEGOTIABLE）：
 * AI 回應 MUST NOT 包含可直接複製貼上、即可通過該題單元測試的完整解答實作。
 *
 * 後處理層是確定性的最後一道關卡——prompt 圍欄擋不住的，這裡要擋下來。
 */
describe('圍欄後處理 —— 攔截完整解答', () => {
  it.each(recorded.violating.map((r) => [r.id, r.note, r.text] as const))(
    '攔截 %s（%s）',
    (_id, _note, text) => {
      const verdict = inspectResponse(text);
      expect(verdict.blocked).toBe(true);
      expect(verdict.reason).toBeTruthy();
    }
  );

  it('攔截後以引導式訊息取代，MUST NOT 留下任何原始程式碼', () => {
    const violating = recorded.violating[0];
    expect(violating).toBeDefined();

    const result = applyGuardrail(violating!.text);

    expect(result.triggered).toBe(true);
    expect(result.content).toBe(GUARDRAIL_REFUSAL);
    expect(result.content).not.toContain('this.buckets');
    expect(result.content).not.toContain('```');
  });

  it('攔截訊息本身是可理解的引導，不是冷冰冰的錯誤', () => {
    expect(GUARDRAIL_REFUSAL.length).toBeGreaterThan(40);
    expect(GUARDRAIL_REFUSAL).toContain('完整');
  });
});

describe('圍欄後處理 —— 放行合規回應', () => {
  it.each(recorded.compliant.map((r) => [r.id, r.note, r.text] as const))(
    '放行 %s（%s）',
    (_id, _note, text) => {
      const verdict = inspectResponse(text);
      expect(verdict.blocked).toBe(false);
    }
  );

  it('放行時內容原樣保留', () => {
    const compliant = recorded.compliant[0];
    expect(compliant).toBeDefined();

    const result = applyGuardrail(compliant!.text);
    expect(result.triggered).toBe(false);
    expect(result.content).toBe(compliant!.text);
  });
});

describe('圍欄後處理 —— 判定邊界', () => {
  it('沒有程式碼區塊的純文字一律放行', () => {
    expect(inspectResponse('先想想這題的邊界條件有哪些？').blocked).toBe(false);
  });

  it('極短的示意片段（≤ 門檻）放行', () => {
    const text = '你需要的大概是：\n\n```javascript\nbucket.shift();\n```\n\n想想何時該呼叫它。';
    expect(inspectResponse(text).blocked).toBe(false);
  });

  it('含完整函式定義且超過長度門檻的區塊被攔截', () => {
    const text = [
      '```javascript',
      'function solve(input) {',
      '  const result = [];',
      '  for (const item of input) {',
      '    if (item > 0) {',
      '      result.push(item * 2);',
      '    }',
      '  }',
      '  return result;',
      '}',
      '```',
    ].join('\n');
    expect(inspectResponse(text).blocked).toBe(true);
  });

  it('多個小區塊合計超過總量門檻時一併攔截（分段索取後自行拼裝）', () => {
    const block = (name: string) =>
      [
        '```javascript',
        `${name}(key) {`,
        '  const v = this.map.get(key);',
        '  this.map.delete(key);',
        '  this.map.set(key, v);',
        '  return v;',
        '}',
        '```',
      ].join('\n');
    const text = `${block('get')}\n\n${block('put')}\n\n${block('peek')}`;
    expect(inspectResponse(text).blocked).toBe(true);
  });

  it('以註解偽裝的完整實作同樣被攔截', () => {
    const text = [
      '```javascript',
      '// function solve(input) {',
      '//   const out = [];',
      '//   for (const x of input) {',
      '//     out.push(x * 2);',
      '//   }',
      '//   return out;',
      '// }',
      '```',
    ].join('\n');
    expect(inspectResponse(text).blocked).toBe(true);
  });

  it('長串 base64 被攔截（編碼夾帶）', () => {
    const payload = 'Y2xhc3MgUmF0ZUxpbWl0ZXIgeyBjb25zdHJ1Y3RvcigpIHt9IH0'.repeat(4);
    expect(inspectResponse(`這是內容：\n\n\`\`\`\n${payload}\n\`\`\``).blocked).toBe(true);
  });

  it('判定不受縮排或語言標記影響', () => {
    const withoutLang = [
      '```',
      'def solve(items):',
      '    out = []',
      '    for x in items:',
      '        if x > 0:',
      '            out.append(x * 2)',
      '    return out',
      '```',
    ].join('\n');
    expect(inspectResponse(withoutLang).blocked).toBe(true);
  });

  it('未閉合的程式碼區塊也納入判定（串流中途不得漏接）', () => {
    const unterminated = [
      '```javascript',
      'class LRUCache {',
      '  constructor(capacity) {',
      '    this.capacity = capacity;',
      '    this.map = new Map();',
      '  }',
      '  get(key) {',
      '    return this.map.get(key);',
      '  }',
    ].join('\n');
    expect(inspectResponse(unterminated).blocked).toBe(true);
  });
});
