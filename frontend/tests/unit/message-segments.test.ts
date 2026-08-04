import { describe, it, expect } from 'vitest';
import { segmentMessage } from '../../src/lib/message-segments';
import type { CodeBlock } from '../../src/types';

const block = (overrides: Partial<CodeBlock> = {}): CodeBlock => ({
  blockIndex: 0,
  language: 'javascript',
  content: 'function solve() {\n  return 1;\n}\n',
  ...overrides,
});

describe('segmentMessage', () => {
  it('沒有區塊時整段視為說明文字', () => {
    expect(segmentMessage('先想想邊界條件。', [])).toEqual([
      { kind: 'prose', key: 'p0', text: '先想想邊界條件。' },
    ]);
  });

  it('串流中（blocks 尚未抵達）原樣回傳，圍籬照樣可見', () => {
    const raw = '我先做一版：\n\n```javascript\nfunction solve() {}\n```\n';
    const segments = segmentMessage(raw, undefined);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: 'prose' });
    // 憲章原則 I：AI 的輸出不因尚未解析而被藏起來
    expect((segments[0] as { text: string }).text).toContain('function solve');
  });

  it('說明與程式碼交錯切分，圍籬不留在說明文字裡', () => {
    const b = block();
    const raw = `我先照你的需求做一版。\n\n\`\`\`javascript\n${b.content}\`\`\`\n\n時間複雜度 O(n)。`;

    const segments = segmentMessage(raw, [b]);

    expect(segments.map((s) => s.kind)).toEqual(['prose', 'code', 'prose']);
    expect((segments[0] as { text: string }).text).toBe('我先照你的需求做一版。');
    expect((segments[2] as { text: string }).text).toBe('時間複雜度 O(n)。');
    // 說明文字裡 MUST NOT 殘留圍籬符號
    expect(
      segments.filter((s) => s.kind === 'prose').every((s) => !JSON.stringify(s).includes('```'))
    ).toBe(true);
  });

  it('多個區塊各自成段且順序不變', () => {
    const b0 = block({ blockIndex: 0, content: 'const a = 1;\n' });
    const b1 = block({ blockIndex: 1, content: 'const b = 2;\n', language: 'typescript' });
    const raw =
      '第一段：\n\n```javascript\nconst a = 1;\n```\n\n第二段：\n\n```typescript\nconst b = 2;\n```\n';

    const segments = segmentMessage(raw, [b1, b0]); // 刻意亂序傳入

    const codes = segments.filter((s) => s.kind === 'code') as { block: CodeBlock }[];
    expect(codes.map((c) => c.block.blockIndex)).toEqual([0, 1]);
    expect(codes[0]!.block.content).toBe('const a = 1;\n');
  });

  it('未閉合的區塊（後端補了結尾換行）仍能定位', () => {
    // 原文結束於程式碼中途，沒有收尾圍籬；後端的 _join 會補上 \n
    const raw = '來不及寫完：\n\n```javascript\nconst a = 1;';
    const b = block({ content: 'const a = 1;\n' });

    const segments = segmentMessage(raw, [b]);

    expect(segments.map((s) => s.kind)).toEqual(['prose', 'code']);
  });

  it('定位不到的區塊補在最後，MUST NOT 被丟棄', () => {
    // 內容與原文對不上（例如訊息在後端另行改寫過）——寧可多顯示也不能讓應試者拿不到
    const b = block({ content: '完全不在原文裡的程式碼\n' });
    const segments = segmentMessage('只有說明文字。', [b]);

    expect(segments.map((s) => s.kind)).toEqual(['prose', 'code']);
    expect((segments[1] as { block: CodeBlock }).block.content).toBe('完全不在原文裡的程式碼\n');
  });

  it('區塊內容逐字保留，不做任何裁切或改寫（SC-004）', () => {
    const content = '  const indented = 1;\n\n\n  return indented;\n';
    const b = block({ content });
    const raw = `\`\`\`javascript\n${content}\`\`\``;

    const segments = segmentMessage(raw, [b]);
    const code = segments.find((s) => s.kind === 'code') as { block: CodeBlock };

    expect(code.block.content).toBe(content);
  });
});
