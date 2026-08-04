import type { Context, MiddlewareHandler } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import { AppError } from './errors.js';
import { getEnv } from './env.js';
import {
  findSessionById,
  findInviteToken,
  markTokenUsed,
  startSession,
  nowIso,
} from '../db/queries.js';
import { isTerminal } from '../domain/session-state.js';

const COOKIE_NAME = 'session';
/** Cookie 壽命略長於最長場次，避免作答中途失效；場次終態後不再有寫入權。 */
const COOKIE_MAX_AGE_SEC = 6 * 60 * 60;

export interface SessionContext {
  sessionId: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    session: SessionContext;
  }
}

/**
 * 兌換邀請 token 並換發 session cookie（R-009）。
 *
 * - 首次兌換：寫入 `startedAt` 與 `deadlineAt`，狀態轉為 `in_progress`
 * - 重複兌換且場次仍 `in_progress`：沿用既有場次，MUST NOT 重置 `deadlineAt`
 * - token 逾期、場次已進入終態：拒絕，且 MUST NOT 讓應試者進入可作答狀態（FR-031）
 */
export function redeemToken(token: string): { sessionId: string } {
  const invite = findInviteToken(token);
  if (!invite) {
    throw new AppError('TOKEN_INVALID');
  }

  const session = findSessionById(invite.session_id);
  if (!session) {
    throw new AppError('TOKEN_INVALID');
  }

  // 場次終態優先於 token 逾期回報：對應試者而言「已提交」是更精確的說明。
  if (isTerminal(session.status)) {
    throw new AppError('SESSION_SUBMITTED');
  }

  if (Date.parse(invite.expires_at) <= Date.now()) {
    throw new AppError('TOKEN_EXPIRED');
  }

  if (session.status === 'not_started') {
    const startedAt = nowIso();
    const deadlineAt = new Date(Date.parse(startedAt) + session.duration_sec * 1000).toISOString();
    startSession(session.id, startedAt, deadlineAt);
    markTokenUsed(token, startedAt);
  }

  return { sessionId: session.id };
}

export async function issueSessionCookie(c: Context, sessionId: string): Promise<void> {
  const env = getEnv();
  await setSignedCookie(c, COOKIE_NAME, sessionId, env.SESSION_SECRET, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

/** 除 `POST /api/session/redeem` 外，所有端點以 HttpOnly session cookie 授權。 */
export const requireSession: MiddlewareHandler = async (c, next) => {
  const signed = await getSignedCookie(c, getEnv().SESSION_SECRET, COOKIE_NAME);
  if (!signed || typeof signed !== 'string') {
    throw new AppError('UNAUTHORIZED');
  }

  const session = findSessionById(signed);
  if (!session) {
    throw new AppError('UNAUTHORIZED');
  }

  c.set('session', { sessionId: session.id });
  await next();
};

export function currentSessionId(c: Context): string {
  const ctx = c.get('session');
  if (!ctx) {
    throw new AppError('UNAUTHORIZED');
  }
  return ctx.sessionId;
}
