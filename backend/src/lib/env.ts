import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * 型別安全的環境變數載入。
 *
 * 憲章「憑證隔離」：`GEMINI_API_KEY` 只在此模組讀取，並且只被 `src/ai/*` 消費。
 * 任何前端可觸及的模組 MUST NOT 匯入本檔。
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_PATH: z.string().min(1).default('./data/portal.db'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 至少需要 32 個字元'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  AI_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  /**
   * 以腳本化的假回應取代真實模型，供 e2e 端到端驗證串流與圍欄。
   * 在 production 一律無效（見 `isAiFake`）——這個開關不得成為關掉模型的後門。
   */
  AI_FAKE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 載入 `backend/.env`（若存在）。使用 Node 內建的 `loadEnvFile`，
 * 不引入 dotenv —— 少一個能讀到金鑰的相依套件。
 * 既有的 process.env 優先，因此 CI 注入的變數不會被檔案覆蓋。
 */
function loadEnvFile(): void {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // 格式錯誤時交由下方的 schema 驗證回報缺少哪些變數。
  }
}

function load(): Env {
  loadEnvFile();
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  const parsed = envSchema.safeParse({
    ...process.env,
    // 測試環境提供可運作的預設值，避免每個測試檔都要自備 .env。
    ...(isTest
      ? {
          NODE_ENV: 'test',
          SESSION_SECRET:
            process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-characters-long',
          DATABASE_PATH: process.env.DATABASE_PATH ?? ':memory:',
        }
      : {}),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`環境變數設定錯誤（請對照 backend/.env.example）：\n${issues}`);
  }

  return parsed.data;
}

let cached: Env | null = null;

export function getEnv(): Env {
  cached ??= load();
  return cached;
}

/** 測試用：清除快取以便重新載入不同的環境設定。 */
export function resetEnvCache(): void {
  cached = null;
}

/** 是否使用腳本化的假回應。production 一律關閉，不接受任何環境變數覆寫。 */
export function isAiFake(): boolean {
  const env = getEnv();
  return env.NODE_ENV !== 'production' && env.AI_FAKE;
}

/** AI 功能是否可用；未設定金鑰時路由層回 `AI_UNAVAILABLE` 而非崩潰。 */
export function isAiConfigured(): boolean {
  return isAiFake() || getEnv().GEMINI_API_KEY.length > 0;
}
