import { useSessionStore } from '../../src/store/session';
import type { Question, SessionPayload } from '../../src/types';

export function makeQuestion(overrides: Partial<Question> & { id: string }): Question {
  return {
    title: `題目 ${overrides.id}`,
    difficulty: 'medium',
    points: 40,
    description: `${overrides.id} 的描述`,
    examples: [{ input: 'in', output: 'out' }],
    complexityRequirement: 'O(1)',
    gradingFocus: ['邊界條件'],
    starterCode: {
      javascript: `// starter ${overrides.id}`,
      typescript: `// starter ts ${overrides.id}`,
      python: `# starter py ${overrides.id}`,
      go: `// starter go ${overrides.id}`,
    },
    quickPrompts: ['檢查 Corner Cases'],
    order: 1,
    testCount: 3,
    ...overrides,
  };
}

export function makePayload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    session: {
      id: 's1',
      candidateName: 'Alex Chen',
      positionTitle: '資深全端工程師模擬面試',
      deadlineAt: new Date(Date.now() + 3600_000).toISOString(),
      status: 'in_progress',
      guidanceMode: 'light',
    },
    questions: [
      makeQuestion({ id: 'q1', title: 'API 限流器', order: 1, difficulty: 'medium', points: 40 }),
      makeQuestion({ id: 'q2', title: 'LRU 快取', order: 2, difficulty: 'easy', points: 30 }),
      makeQuestion({ id: 'q3', title: '訊息佇列', order: 3, difficulty: 'hard', points: 30 }),
    ],
    answers: [],
    chat: [],
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

/** 以完整場次載入 store，供元件測試使用。 */
export function loadTestSession(overrides: Partial<SessionPayload> = {}): SessionPayload {
  const payload = makePayload(overrides);
  useSessionStore.getState().reset();
  useSessionStore.getState().loadSession(payload);
  return payload;
}
