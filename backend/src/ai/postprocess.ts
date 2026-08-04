/**
 * 輸出後處理攔截層（憲章原則 I，NON-NEGOTIABLE；R-006 第三層防線）。
 *
 * System prompt 圍欄擋不住所有越獄輸入——測試中「偽裝成除錯請求」這一類的失敗率
 * 不可接受。本層提供確定性的最後關卡，也讓自動化越獄測試有可斷言的對象。
 *
 * 判定原則：寧可誤攔一段冗長的示意程式碼，也不能放行一份可貼上就通過測試的實作。
 */

/**
 * 沒有函式／類別定義、但長度已超過此行數的區塊視為「不只是示意」。
 * 有定義且有實作內容者不看長度——6 行的完整函式一樣可以直接貼上。
 */
const MAX_LINES_PER_BLOCK = 6;

/** 所有區塊合計的行數上限，擋下「分段索取後自行拼裝」。 */
const MAX_TOTAL_LINES = 12;

/** 連續 base64 字元達此長度即視為編碼夾帶。 */
const MAX_BASE64_RUN = 120;

/** 具備函式／類別／方法定義的樣式（涵蓋 JS / TS / Python / Go）。 */
const DEFINITION_PATTERNS = [
  /\bclass\s+[A-Za-z_$][\w$]*/,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/,
  /\bdef\s+[A-Za-z_][\w]*\s*\(/,
  /\bfunc\s+(\([^)]*\)\s*)?[A-Za-z_][\w]*\s*\(/,
  /\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  // 物件／類別中的方法簡寫：`get(key) {`
  /^\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/m,
];

/** 具備實作內容（而非僅簽名）的訊號。 */
const BODY_PATTERNS = [
  /\breturn\b/,
  /\bfor\b/,
  /\bwhile\b/,
  /\bif\b/,
  /=/,
  /\bappend\b/,
  /\bpush\b/,
];

export interface GuardrailVerdict {
  blocked: boolean;
  reason?: string;
}

export interface GuardrailResult {
  content: string;
  triggered: boolean;
  reason?: string;
}

/** 攔截後回覆給應試者的引導式訊息。 */
export const GUARDRAIL_REFUSAL = [
  '我不能提供完整的實作——那會讓這場面試失去意義，對你也沒有幫助。',
  '',
  '換個方式：告訴我你目前卡在哪一步，或把你的想法講給我聽，我可以幫你檢查思路的漏洞、',
  '一起推導複雜度，或指出你可能還沒考慮到的邊界條件。',
  '',
  '如果你已經寫了一部分，也可以用「傳送至 AI 側邊欄」讓我看看，我會指出問題所在與修正方向，',
  '但修正本身要你自己動手。',
].join('\n');

interface CodeBlock {
  language: string;
  lines: string[];
}

/**
 * 取出 markdown 圍籬區塊。未閉合的區塊也要納入——
 * 串流到一半的回應若含完整實作，同樣不得放行。
 */
function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = text.split('\n');

  let inBlock = false;
  let language = '';
  let buffer: string[] = [];

  for (const line of lines) {
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      if (inBlock) {
        blocks.push({ language, lines: buffer });
        inBlock = false;
        buffer = [];
      } else {
        inBlock = true;
        language = fence[1] ?? '';
      }
      continue;
    }
    if (inBlock) buffer.push(line);
  }

  if (inBlock && buffer.length > 0) {
    blocks.push({ language, lines: buffer });
  }

  return blocks;
}

/** 去除註解標記後的有效程式碼行——以註解偽裝的實作不該因此逃過判定。 */
function effectiveLines(lines: string[]): string[] {
  return lines
    .map((line) => line.replace(/^\s*(\/\/|#)\s?/, '').trim())
    .filter((line) => line.length > 0 && line !== '*/' && line !== '/*');
}

function looksLikeImplementation(source: string): boolean {
  const hasDefinition = DEFINITION_PATTERNS.some((p) => p.test(source));
  const hasBody = BODY_PATTERNS.some((p) => p.test(source));
  return hasDefinition && hasBody;
}

function hasLongBase64Run(text: string): boolean {
  return new RegExp(`[A-Za-z0-9+/=]{${MAX_BASE64_RUN},}`).test(text.replace(/\s+/g, ''));
}

export function inspectResponse(text: string): GuardrailVerdict {
  const blocks = extractCodeBlocks(text);

  if (blocks.length === 0) {
    return { blocked: false };
  }

  let totalLines = 0;

  for (const block of blocks) {
    const lines = effectiveLines(block.lines);
    totalLines += lines.length;
    const source = lines.join('\n');

    if (hasLongBase64Run(source)) {
      return { blocked: true, reason: 'base64_payload' };
    }

    // 有定義又有實作內容 —— 不論多短都是可貼上的解答。
    if (looksLikeImplementation(source)) {
      return { blocked: true, reason: 'complete_implementation' };
    }

    // 沒有可辨識的定義，但已經是一大段可執行的程式碼。
    if (lines.length > MAX_LINES_PER_BLOCK && BODY_PATTERNS.some((p) => p.test(source))) {
      return { blocked: true, reason: 'long_code_block' };
    }
  }

  if (totalLines > MAX_TOTAL_LINES) {
    const combined = blocks.flatMap((b) => effectiveLines(b.lines)).join('\n');
    if (looksLikeImplementation(combined)) {
      return { blocked: true, reason: 'assembled_implementation' };
    }
  }

  return { blocked: false };
}

/**
 * 套用圍欄。命中時整段以引導式訊息取代——
 * MUST NOT 只遮蔽部分內容，殘留的片段一樣有價值。
 */
export function applyGuardrail(text: string): GuardrailResult {
  const verdict = inspectResponse(text);

  if (!verdict.blocked) {
    return { content: text, triggered: false };
  }

  return {
    content: GUARDRAIL_REFUSAL,
    triggered: true,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
  };
}
