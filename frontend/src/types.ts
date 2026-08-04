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

export type GuidanceMode = 'light' | 'deep';

export type ChatRole = 'candidate' | 'assistant' | 'system';

export type ChatSource = 'typed' | 'quick_prompt' | 'question_hint' | 'code_review';

export type Difficulty = 'easy' | 'medium' | 'hard';

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
  guidanceMode: GuidanceMode;
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
