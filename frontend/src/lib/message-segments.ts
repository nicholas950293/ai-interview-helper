import type { CodeBlock } from '../types';

/**
 * 把 AI 回覆切成「說明」與「可套用的程式碼區塊」交錯的片段。
 *
 * 刻意**不**在前端重寫一套 markdown 圍籬解析器：後端已經在完整回覆上解析並把
 * 區塊逐字存進資料庫，那一份才是套用時的比對對象（SC-004 / research R-013）。
 * 這裡改以「區塊內容在原文中的位置」為錨點去切，兩邊因此不可能對不上。
 *
 * 憲章原則 I：AI 的輸出 MUST 完整呈現。任何定位不到的區塊會被補在最後，
 * 而不是被丟掉——寧可多顯示一次，也不能讓應試者拿不到 AI 已經寫好的東西。
 */
export type MessageSegment =
  { kind: 'prose'; key: string; text: string } | { kind: 'code'; key: string; block: CodeBlock };

/** 收尾圍籬：可能有前導空白，可能沒有換行（訊息結束於此）。 */
const CLOSING_FENCE = /^[ \t]*```[^\n]*\n?/;

export function segmentMessage(content: string, blocks: CodeBlock[] = []): MessageSegment[] {
  if (blocks.length === 0) {
    return content.length > 0 ? [{ kind: 'prose', key: 'p0', text: content }] : [];
  }

  const ordered = [...blocks].sort((a, b) => a.blockIndex - b.blockIndex);
  const segments: MessageSegment[] = [];
  const unlocated: CodeBlock[] = [];
  let cursor = 0;

  const pushProse = (text: string) => {
    if (text.trim().length === 0) return;
    // 只去掉圍籬前後的空行（那是 markdown 的結構，不是內容）；
    // 行內縮排與段落之間的單一空行照原樣保留。
    segments.push({
      kind: 'prose',
      key: `p${segments.length}`,
      text: text.replace(/^\n+/, '').replace(/\n+$/, ''),
    });
  };

  for (const block of ordered) {
    // 後端的 `_join` 會補上結尾換行，未閉合的區塊因此可能比原文多一個 \n
    const candidates = [block.content, block.content.replace(/\n$/, '')];
    const found = candidates
      .map((needle) => ({ needle, at: needle ? content.indexOf(needle, cursor) : -1 }))
      .find((c) => c.at >= 0);

    if (!found) {
      unlocated.push(block);
      continue;
    }

    // 開頭圍籬在區塊內容之前；找不到（例如模型省略了圍籬）就直接由內容起算
    const fenceStart = content.lastIndexOf('```', found.at);
    pushProse(content.slice(cursor, fenceStart >= cursor ? fenceStart : found.at));
    segments.push({ kind: 'code', key: `c${block.blockIndex}`, block });

    let after = found.at + found.needle.length;
    const closing = CLOSING_FENCE.exec(content.slice(after));
    if (closing) after += closing[0].length;
    cursor = after;
  }

  pushProse(content.slice(cursor));

  for (const block of unlocated) {
    segments.push({ kind: 'code', key: `c${block.blockIndex}`, block });
  }

  return segments;
}
