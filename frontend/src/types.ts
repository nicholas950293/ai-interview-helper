/**
 * 前端型別 —— 對應 contracts/http-api.md 的回應形狀。
 *
 * 刻意不從 backend 匯入：兩個套件只透過 HTTP 契約耦合，
 * 前端不得意外取得任何伺服端專屬型別（例如 predefinedTests）。
 */

export type Language = 'javascript' | 'typescript' | 'python' | 'go';

export const SUPPORTED_LANGUAGES: readonly Language[] = [
  'javascript',
  'typescript',
  'python',
  'go',
];

export const LANGUAGE_LABELS: Record<Language, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  go: 'Go',
};

export type SessionStatus = 'not_started' | 'in_progress' | 'submitted' | 'expired_submitted';

/** 協作模式（FR-012）。兩者皆不限制 AI 輸出的完整性（憲章原則 I）。 */
export type CollaborationMode = 'discuss' | 'implement';

export type ChatRole = 'candidate' | 'assistant' | 'system';

export type ChatSource = 'typed' | 'quick_prompt' | 'question_hint' | 'code_review';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** 環境事件類型（FR-025）—— 僅客觀事實，無判定性類型。 */
export type EnvironmentEventType = 'window_blur' | 'tab_hidden';

/** 保存狀態指示的四態（contracts/ui-contracts.md「元件狀態契約」）。 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type Connectivity = 'online' | 'offline';

export interface Example {
  input: string;
  output: string;
  note?: string;
}

export interface Question {
  id: string;
  title: string;
  difficulty: Difficulty;
  points: number;
  description: string;
  examples: Example[];
  complexityRequirement: string;
  gradingFocus: string[];
  starterCode: Partial<Record<Language, string>>;
  quickPrompts: string[];
  order: number;
  /** 只有數量，沒有個別案例的期望值（FR-030）。 */
  testCount: number;
}

/** 場次 —— 僅含姓名與職稱兩項個資（FR-032）。 */
export interface Session {
  id: string;
  candidateName: string;
  positionTitle: string;
  deadlineAt: string | null;
  status: SessionStatus;
  collaborationMode: CollaborationMode;
}

/**
 * AI 回覆中可套用的程式碼區塊（FR-033）。
 *
 * 由後端在**完整回覆**上解析並留存，前端不自行從串流片段拼裝——
 * 套用的逐字一致性（SC-004）比對的是資料庫裡的那一份（research R-013）。
 */
export interface CodeBlock {
  blockIndex: number;
  language: string | null;
  content: string;
}

export interface ChatMessage {
  id: string;
  questionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  attachedCode: string | null;
  /** 串流中的訊息尚未落地，僅存在於前端。 */
  pending?: boolean;
  /** 串流結束（`blocks` 事件）後才有值；重新載入時由 bootstrap 帶回。 */
  codeBlocks?: CodeBlock[];
}

export interface AnswerState {
  language: Language;
  content: string;
  saveState: SaveState;
  revision: number;
  savedAt: string | null;
  /** 已輸入但尚未送達伺服端的變更。 */
  dirty: boolean;
}

export interface TestResult {
  questionId: string;
  passed: number;
  total: number;
  ranAt: string;
}

export interface SessionPayload {
  session: Session;
  questions: Question[];
  answers: {
    questionId: string;
    language: Language;
    content: string;
    savedAt: string;
    revision: number;
  }[];
  chat: ChatMessage[];
  serverTime: string;
}
