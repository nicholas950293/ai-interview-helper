import { z } from 'zod';

/** 作答內容上限 256 KB（data-model.md：Answer 驗證規則）。 */
export const MAX_CONTENT_BYTES = 256 * 1024;

/** 環境事件門檻：短於 1000ms 的離開 MUST NOT 記錄（濾除焦點抖動）。 */
export const ENVIRONMENT_EVENT_MIN_DURATION_MS = 1000;

/** 剩餘時間低於此值時計時器轉為警示呈現（FR-020）。 */
export const TIMER_WARNING_THRESHOLD_SEC = 5 * 60;

export const languageSchema = z.enum(['javascript', 'typescript', 'python', 'go']);
export type Language = z.infer<typeof languageSchema>;

export const SUPPORTED_LANGUAGES: readonly Language[] = languageSchema.options;

export const sessionStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'submitted',
  'expired_submitted',
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const guidanceModeSchema = z.enum(['light', 'deep']);
export type GuidanceMode = z.infer<typeof guidanceModeSchema>;

export const chatRoleSchema = z.enum(['candidate', 'assistant', 'system']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatSourceSchema = z.enum(['typed', 'quick_prompt', 'question_hint', 'code_review']);
export type ChatSource = z.infer<typeof chatSourceSchema>;

export const environmentEventTypeSchema = z.enum(['window_blur', 'tab_hidden']);
export type EnvironmentEventType = z.infer<typeof environmentEventTypeSchema>;

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof difficultySchema>;

export const inviteTokenStatusSchema = z.enum(['pending', 'active', 'consumed', 'expired']);
export type InviteTokenStatus = z.infer<typeof inviteTokenStatusSchema>;

// --- 實體 -------------------------------------------------------------------

export const exampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  note: z.string().optional(),
});
export type Example = z.infer<typeof exampleSchema>;

export const testCaseSchema = z.object({
  name: z.string(),
  expectedPass: z.boolean(),
});
export type TestCase = z.infer<typeof testCaseSchema>;

/**
 * 對外呈現的題目 —— 刻意不含 `predefinedTests`：
 * 其內容 MUST NOT 出現在任何回應中，避免應試者反推期望輸出（FR-030）。
 */
export const publicQuestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  difficulty: difficultySchema,
  points: z.number().int(),
  description: z.string(),
  examples: z.array(exampleSchema),
  complexityRequirement: z.string(),
  gradingFocus: z.array(z.string()),
  starterCode: z.record(languageSchema, z.string()),
  quickPrompts: z.array(z.string()),
  order: z.number().int(),
  testCount: z.number().int().nonnegative(),
});
export type PublicQuestion = z.infer<typeof publicQuestionSchema>;

/**
 * 對外呈現的場次 —— 僅含姓名與職稱兩項個資（FR-032）。
 * 新增欄位前 MUST 確認不引入其他個人資料。
 */
export const publicSessionSchema = z.object({
  id: z.string(),
  candidateName: z.string(),
  positionTitle: z.string(),
  deadlineAt: z.string().nullable(),
  status: sessionStatusSchema,
  guidanceMode: guidanceModeSchema,
});
export type PublicSession = z.infer<typeof publicSessionSchema>;

export const publicAnswerSchema = z.object({
  questionId: z.string(),
  language: languageSchema,
  content: z.string(),
  savedAt: z.string(),
  revision: z.number().int(),
});
export type PublicAnswer = z.infer<typeof publicAnswerSchema>;

export const publicChatMessageSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  role: chatRoleSchema,
  content: z.string(),
  createdAt: z.string(),
  attachedCode: z.string().nullable(),
});
export type PublicChatMessage = z.infer<typeof publicChatMessageSchema>;

// --- 請求 body ---------------------------------------------------------------

export const redeemRequestSchema = z.object({
  token: z.string().min(1),
});

const contentWithinLimit = z
  .string()
  .refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_CONTENT_BYTES, {
    message: 'CONTENT_TOO_LARGE',
  });

export const saveAnswerRequestSchema = z.object({
  language: languageSchema,
  content: contentWithinLimit,
  revision: z.number().int().nonnegative(),
});
export type SaveAnswerRequest = z.infer<typeof saveAnswerRequestSchema>;

/** 離線補送：一次帶多筆，伺服端依 revision 排序套用。 */
export const saveAnswersBatchRequestSchema = z
  .array(saveAnswerRequestSchema.extend({ questionId: z.string().min(1) }))
  .min(1);
export type SaveAnswersBatchRequest = z.infer<typeof saveAnswersBatchRequestSchema>;

export const chatRequestSchema = z.object({
  questionId: z.string().min(1),
  content: z.string().min(1).max(8000),
  attachCode: z.boolean().default(false),
  source: chatSourceSchema.default('typed'),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatSystemRequestSchema = z.object({
  fromQuestionId: z.string().min(1),
  toQuestionId: z.string().min(1),
});

export const guidanceModeRequestSchema = z.object({
  mode: guidanceModeSchema,
});

export const environmentEventsRequestSchema = z
  .array(
    z.object({
      type: environmentEventTypeSchema,
      startedAt: z.string().min(1),
      durationMs: z.number().int().nonnegative(),
    })
  )
  .min(1);
export type EnvironmentEventsRequest = z.infer<typeof environmentEventsRequestSchema>;
