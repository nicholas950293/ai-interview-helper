import { GoogleGenAI } from '@google/genai';
import { getEnv, isAiConfigured, isAiFake } from '../lib/env.js';
import { AppError } from '../lib/errors.js';
import { buildSystemInstruction, type PromptContext } from './guardrails.js';

/**
 * Gemini 呼叫與串流（FR-029）。
 *
 * 金鑰只從 `env.ts` 取得，只在本模組使用——這是憲章「憑證隔離」的唯一出口。
 * 應試者的輸入一律作為 user turn 傳入，永遠不進入 system instruction。
 */

export interface ChatTurn {
  role: 'candidate' | 'assistant';
  content: string;
}

export interface StreamRequest {
  context: PromptContext;
  /** 先前的對話歷程，供模型理解脈絡。 */
  history: ChatTurn[];
  /** 本次提問——來自前端，一律是 user turn。 */
  prompt: string;
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!isAiConfigured()) {
    throw new AppError('AI_UNAVAILABLE');
  }
  client ??= new GoogleGenAI({ apiKey: getEnv().GEMINI_API_KEY });
  return client;
}

/** 測試用：注入假的串流來源，避免測試打到真實模型。 */
export type StreamFactory = (req: StreamRequest) => AsyncIterable<string>;

let streamFactoryOverride: StreamFactory | null = null;

export function setStreamFactory(factory: StreamFactory | null): void {
  streamFactoryOverride = factory;
  client = null;
}

async function* callGemini(req: StreamRequest): AsyncIterable<string> {
  const env = getEnv();
  const ai = getClient();

  const contents = [
    ...req.history.map((turn) => ({
      role: turn.role === 'candidate' ? ('user' as const) : ('model' as const),
      parts: [{ text: turn.content }],
    })),
    { role: 'user' as const, parts: [{ text: req.prompt }] },
  ];

  let stream: AsyncIterable<{ text?: string }>;
  try {
    stream = await ai.models.generateContentStream({
      model: env.GEMINI_MODEL,
      contents,
      config: {
        // 圍欄放在 systemInstruction，前端內容永遠到不了這裡。
        systemInstruction: buildSystemInstruction(req.context),
        temperature: req.context.mode === 'deep' ? 0.7 : 0.4,
        maxOutputTokens: req.context.mode === 'deep' ? 1600 : 700,
      },
    });
  } catch (err) {
    console.error('[ai] generateContentStream failed', err);
    throw new AppError('AI_UNAVAILABLE');
  }

  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}

/** 索取完整解答的意圖偵測——只用於假回應，真實模型的判定由圍欄與後處理層負責。 */
const SOLICITATION = /完整|解答|答案|全部|貼上|full|solution|implementation|重寫|修好/i;

const FAKE_LEAKED_SOLUTION = [
  '沒問題，這是完整的實作：',
  '',
  '```javascript',
  'class RateLimiter {',
  '  constructor(maxRequests, windowMs) {',
  '    this.maxRequests = maxRequests;',
  '    this.windowMs = windowMs;',
  '    this.buckets = new Map();',
  '  }',
  '',
  '  allow(userId, timestampMs) {',
  '    const bucket = this.buckets.get(userId) ?? [];',
  '    while (bucket.length > 0 && bucket[0] <= timestampMs - this.windowMs) {',
  '      bucket.shift();',
  '    }',
  '    if (bucket.length >= this.maxRequests) return false;',
  '    bucket.push(timestampMs);',
  '    this.buckets.set(userId, bucket);',
  '    return true;',
  '  }',
  '}',
  '```',
].join('\n');

const FAKE_GUIDANCE = [
  '先想一個問題：當同一個使用者在時間窗內連續發出請求，你需要記住的到底是「次數」還是「每一次的時間點」？',
  '',
  '如果只記次數，窗滑動時你要怎麼知道該扣掉幾次？這個問題會直接決定你選什麼資料結構。',
  '',
  '另外提醒一個容易漏掉的邊界：兩個請求的時間戳完全相同時，你的判斷還成立嗎？',
].join('\n');

/**
 * 腳本化的假回應。刻意在被索取完整解答時「洩漏」一份可貼上的實作——
 * 這樣 e2e 才能端到端證明後處理層真的把它擋下來，而不是只有單元測試說有擋。
 */
async function* fakeStream(req: StreamRequest): AsyncIterable<string> {
  const text = SOLICITATION.test(req.prompt) ? FAKE_LEAKED_SOLUTION : FAKE_GUIDANCE;

  for (const chunk of text.match(/[\s\S]{1,24}/g) ?? []) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    yield chunk;
  }
}

export function streamCompletion(req: StreamRequest): AsyncIterable<string> {
  if (streamFactoryOverride) return streamFactoryOverride(req);
  if (isAiFake()) return fakeStream(req);
  return callGemini(req);
}
