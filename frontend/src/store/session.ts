import { create } from 'zustand';
import type {
  AnswerState,
  ChatMessage,
  Connectivity,
  CollaborationMode,
  Language,
  Question,
  SaveState,
  Session,
  SessionPayload,
  SessionStatus,
  TestResult,
} from '../types';

/**
 * 單一事實來源（憲章原則 II）。
 *
 * 題目區、作答區與 AI 側欄皆為本 store 的消費者，
 * 任何面板 MUST NOT 自行保有 currentQuestion / language / draft 的副本。
 */
export interface SessionState {
  // --- 資料 ---
  session: Session | null;
  questions: Question[];
  currentQuestionId: string;
  answers: Record<string, AnswerState>;
  chat: ChatMessage[];
  collaborationMode: CollaborationMode;
  streaming: { active: boolean; messageId?: string };
  connectivity: Connectivity;
  lastTestResult: TestResult | null;
  /**
   * 正在套用中的區塊鍵（`${messageId}:${blockIndex}`），無則為 null。
   * 只允許一個——套用會整份取代作答內容，同時進行兩個等於互相覆蓋。
   */
  applyingBlockKey: string | null;

  // --- 載入狀態 ---
  phase: 'idle' | 'loading' | 'ready' | 'error';
  loadError: { code: string; message: string } | null;

  /**
   * 伺服端時間與本地時鐘的差（serverTime - clientTime，毫秒）。
   * 計時以伺服端為權威，本地顯示以此偏移修正（R-007）。
   */
  clockOffsetMs: number;

  // --- 動作 ---
  loadSession: (payload: SessionPayload) => void;
  setLoading: () => void;
  setLoadError: (error: { code: string; message: string }) => void;
  setCurrentQuestion: (questionId: string) => void;
  setDraft: (questionId: string, content: string) => void;
  setLanguage: (questionId: string, language: Language, content?: string) => void;
  setSaveState: (questionId: string, saveState: SaveState) => void;
  markSaved: (questionId: string, savedAt: string, revision: number) => void;
  setApplyingBlock: (blockKey: string | null) => void;
  applyAiContent: (
    questionId: string,
    payload: { content: string; savedAt: string; revision: number }
  ) => void;
  appendChatMessage: (message: ChatMessage) => void;
  replaceChatMessage: (id: string, message: Partial<ChatMessage>) => void;
  appendStreamToken: (messageId: string, text: string) => void;
  setCollaborationMode: (mode: CollaborationMode) => void;
  setStreaming: (streaming: { active: boolean; messageId?: string }) => void;
  setConnectivity: (connectivity: Connectivity) => void;
  setSessionStatus: (status: SessionStatus) => void;
  setTestResult: (result: TestResult) => void;
  syncClock: (serverTime: string) => void;
  reset: () => void;
}

const DEFAULT_LANGUAGE: Language = 'javascript';

function starterFor(question: Question | undefined, language: Language): string {
  return question?.starterCode[language] ?? '';
}

function initialAnswers(payload: SessionPayload): Record<string, AnswerState> {
  const answers: Record<string, AnswerState> = {};

  for (const question of payload.questions) {
    answers[question.id] = {
      language: DEFAULT_LANGUAGE,
      content: starterFor(question, DEFAULT_LANGUAGE),
      saveState: 'idle',
      revision: 0,
      savedAt: null,
      dirty: false,
    };
  }

  // 伺服端已保存的草稿覆蓋 starter code（FR-003：重新載入後還原至最後保存狀態）
  for (const saved of payload.answers) {
    answers[saved.questionId] = {
      language: saved.language,
      content: saved.content,
      saveState: 'saved',
      revision: saved.revision,
      savedAt: saved.savedAt,
      dirty: false,
    };
  }

  return answers;
}

const INITIAL = {
  session: null,
  questions: [],
  currentQuestionId: '',
  answers: {},
  chat: [],
  collaborationMode: 'implement' as CollaborationMode,
  streaming: { active: false },
  connectivity: 'online' as Connectivity,
  lastTestResult: null,
  applyingBlockKey: null,
  phase: 'idle' as const,
  loadError: null,
  clockOffsetMs: 0,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...INITIAL,

  loadSession: (payload) =>
    set({
      session: payload.session,
      questions: payload.questions,
      currentQuestionId: payload.questions[0]?.id ?? '',
      answers: initialAnswers(payload),
      chat: payload.chat,
      collaborationMode: payload.session.collaborationMode,
      lastTestResult: null,
      phase: 'ready',
      loadError: null,
      clockOffsetMs: Date.parse(payload.serverTime) - Date.now(),
    }),

  setLoading: () => set({ phase: 'loading', loadError: null }),

  setLoadError: (error) => set({ phase: 'error', loadError: error }),

  setCurrentQuestion: (questionId) => {
    const { questions, answers } = get();
    const question = questions.find((q) => q.id === questionId);
    if (!question) return;

    // 尚無作答紀錄的題目：載入該語言的 starter code（ui-contracts A-01 步驟 5）
    if (!answers[questionId]) {
      set({
        answers: {
          ...answers,
          [questionId]: {
            language: DEFAULT_LANGUAGE,
            content: starterFor(question, DEFAULT_LANGUAGE),
            saveState: 'idle',
            revision: 0,
            savedAt: null,
            dirty: false,
          },
        },
      });
    }

    set({ currentQuestionId: questionId });
  },

  setDraft: (questionId, content) => {
    const existing = get().answers[questionId];
    if (!existing) return;
    set({
      answers: {
        ...get().answers,
        [questionId]: { ...existing, content, dirty: true },
      },
    });
  },

  setLanguage: (questionId, language, content) => {
    const existing = get().answers[questionId];
    if (!existing) return;
    set({
      answers: {
        ...get().answers,
        [questionId]: {
          ...existing,
          language,
          ...(content === undefined ? {} : { content }),
          dirty: true,
        },
      },
    });
  },

  setSaveState: (questionId, saveState) => {
    const existing = get().answers[questionId];
    if (!existing) return;
    set({
      answers: { ...get().answers, [questionId]: { ...existing, saveState } },
    });
  },

  markSaved: (questionId, savedAt, revision) => {
    const existing = get().answers[questionId];
    if (!existing) return;
    set({
      answers: {
        ...get().answers,
        [questionId]: { ...existing, saveState: 'saved', savedAt, revision, dirty: false },
      },
    });
  },

  setApplyingBlock: (blockKey) => set({ applyingBlockKey: blockKey }),

  /**
   * 以 AI 產出整份取代作答（ui-contracts A-05 步驟 4）。
   *
   * `dirty: false` 是關鍵：伺服端已經寫入並記為 `source='ai'`，
   * 若留成 dirty，接下來的 debounce 保存會把同一份內容再送一次、
   * 記成 candidate，作者歸屬就被抹掉了。
   */
  applyAiContent: (questionId, { content, savedAt, revision }) => {
    const existing = get().answers[questionId];
    if (!existing) return;
    set({
      answers: {
        ...get().answers,
        [questionId]: {
          ...existing,
          content,
          savedAt,
          revision,
          saveState: 'saved',
          dirty: false,
        },
      },
    });
  },

  appendChatMessage: (message) => set({ chat: [...get().chat, message] }),

  replaceChatMessage: (id, patch) =>
    set({
      chat: get().chat.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }),

  /** SSE token 以批次方式套用（效能契約：避免每 token 一次全域更新）。 */
  appendStreamToken: (messageId, text) =>
    set({
      chat: get().chat.map((m) => (m.id === messageId ? { ...m, content: m.content + text } : m)),
    }),

  setCollaborationMode: (mode) => set({ collaborationMode: mode }),

  setStreaming: (streaming) => set({ streaming }),

  setConnectivity: (connectivity) => set({ connectivity }),

  setSessionStatus: (status) => {
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, status } });
  },

  setTestResult: (result) => set({ lastTestResult: result }),

  syncClock: (serverTime) => set({ clockOffsetMs: Date.parse(serverTime) - Date.now() }),

  reset: () => set({ ...INITIAL }),
}));
