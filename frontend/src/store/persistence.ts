import { openDB, type IDBPDatabase } from 'idb';
import { useSessionStore } from './session';
import {
  ApiError,
  postEnvironmentEvents,
  saveAnswer,
  saveAnswersBatch,
  type SaveAnswerInput,
} from '../services/api';
import type { Language } from '../types';

/**
 * 草稿保存 —— debounce 1000ms（憲章原則 IV：MUST NOT 逐次按鍵送出請求）
 * 加上 IndexedDB 離線佇列（憲章：草稿不得遺失）。
 *
 * 選 IndexedDB 而非 localStorage：後者的同步寫入會直接吃掉 50ms 的輸入延遲預算（R-008）。
 */
export const SAVE_DEBOUNCE_MS = 1000;

const DB_NAME = 'techinterview-portal';
const DB_VERSION = 2;
const QUEUE_STORE = 'pending-saves';
const EVENT_STORE = 'pending-events';

export interface QueuedSave {
  id?: number;
  questionId: string;
  language: Language;
  content: string;
  revision: number;
  queuedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getQueueDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        db.createObjectStore(EVENT_STORE, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
  return dbPromise;
}

// --- 離線佇列 ---------------------------------------------------------------

export async function enqueueSave(item: Omit<QueuedSave, 'id' | 'queuedAt'>): Promise<void> {
  const db = await getQueueDb();
  await db.add(QUEUE_STORE, { ...item, queuedAt: new Date().toISOString() });
}

/** 依 revision 排序讀出，確保補送順序與作答順序一致。 */
export async function readQueue(): Promise<QueuedSave[]> {
  const db = await getQueueDb();
  const all = (await db.getAll(QUEUE_STORE)) as QueuedSave[];
  return all.sort((a, b) => a.revision - b.revision || (a.id ?? 0) - (b.id ?? 0));
}

export async function clearQueue(): Promise<void> {
  const db = await getQueueDb();
  await db.clear(QUEUE_STORE);
}

/**
 * 恢復連線後批次補送。
 *
 * 失敗時佇列保留且不向外擲出——呼叫端是重試迴圈，
 * 丟掉佇列等於丟掉應試者的作答（FR-023）。回傳是否補送成功供呼叫端決定是否再試。
 */
export async function flushQueue(): Promise<boolean> {
  const queued = await readQueue();
  if (queued.length === 0) return true;

  const payload: SaveAnswerInput[] = queued.map(({ questionId, language, content, revision }) => ({
    questionId,
    language,
    content,
    revision,
  }));

  try {
    await saveAnswersBatch(payload);
  } catch {
    return false;
  }

  await clearQueue();
  return true;
}

// --- 環境事件佇列 -----------------------------------------------------------

export interface QueuedEnvironmentEvent {
  id?: number;
  type: 'window_blur' | 'tab_hidden';
  startedAt: string;
  durationMs: number;
}

/**
 * 環境事件與草稿共用同一套離線補送機制（T096）。
 *
 * 事件在離線期間同樣不能遺失——公正性記錄若因斷線而缺漏，
 * 對後續評分的意義就不完整（憲章「防作弊監測」）。
 */
export async function enqueueEnvironmentEvent(
  event: Omit<QueuedEnvironmentEvent, 'id'>
): Promise<void> {
  const db = await getQueueDb();
  await db.add(EVENT_STORE, event);
}

export async function readEnvironmentQueue(): Promise<QueuedEnvironmentEvent[]> {
  const db = await getQueueDb();
  const all = (await db.getAll(EVENT_STORE)) as QueuedEnvironmentEvent[];
  return all.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

export async function clearEnvironmentQueue(): Promise<void> {
  const db = await getQueueDb();
  await db.clear(EVENT_STORE);
}

/** 與 `flushQueue` 一致：失敗時保留佇列且不向外擲出。 */
export async function flushEnvironmentQueue(): Promise<boolean> {
  const queued = await readEnvironmentQueue();
  if (queued.length === 0) return true;

  try {
    await postEnvironmentEvents(
      queued.map(({ type, startedAt, durationMs }) => ({ type, startedAt, durationMs }))
    );
  } catch {
    return false;
  }

  await clearEnvironmentQueue();
  return true;
}

// --- Debounce 保存 ----------------------------------------------------------

interface PendingSave {
  questionId: string;
  timer: ReturnType<typeof setTimeout>;
}

let pending: PendingSave | null = null;
/** 每題各自的 revision 計數器；伺服端以此偵測失序寫入。 */
const revisions = new Map<string, number>();

function nextRevision(questionId: string): number {
  const store = useSessionStore.getState();
  const current = Math.max(
    revisions.get(questionId) ?? 0,
    store.answers[questionId]?.revision ?? 0
  );
  const next = current + 1;
  revisions.set(questionId, next);
  return next;
}

async function performSave(questionId: string): Promise<void> {
  const store = useSessionStore.getState();
  const answer = store.answers[questionId];
  if (!answer || !answer.dirty) return;

  const input: SaveAnswerInput = {
    questionId,
    language: answer.language,
    content: answer.content,
    revision: nextRevision(questionId),
  };

  store.setSaveState(questionId, 'saving');

  try {
    const result = await saveAnswer(input);
    useSessionStore.getState().markSaved(questionId, result.savedAt, result.revision);
  } catch (err) {
    // 離線：進佇列等待補送，作答內容留在 store 不動。
    if (err instanceof ApiError && err.isOffline) {
      await enqueueSave(input);
      useSessionStore.getState().setConnectivity('offline');
      useSessionStore.getState().setSaveState(questionId, 'error');
      return;
    }

    // 伺服端有較新版本：以伺服端 revision 為準，下次保存從該值續號。
    if (err instanceof ApiError && err.code === 'REVISION_STALE') {
      const serverRevision = Number(err.details?.revision ?? 0);
      revisions.set(questionId, serverRevision);
    }

    useSessionStore.getState().setSaveState(questionId, 'error');
  }
}

/** 排定一次 debounce 保存；切換到另一題時先讓前一題落地，避免內容被丟棄。 */
export function scheduleSave(questionId: string): void {
  if (pending && pending.questionId !== questionId) {
    clearTimeout(pending.timer);
    const previous = pending.questionId;
    pending = null;
    void performSave(previous);
  } else if (pending) {
    clearTimeout(pending.timer);
  }

  const timer = setTimeout(() => {
    pending = null;
    void performSave(questionId);
  }, SAVE_DEBOUNCE_MS);

  pending = { questionId, timer };
}

/**
 * 立即落地待保存的變更。
 *
 * 「傳送至 AI 側邊欄」前 MUST 呼叫，否則伺服端取到的是舊草稿（ui-contracts A-03）。
 */
export async function flushPendingSave(): Promise<void> {
  if (!pending) return;

  clearTimeout(pending.timer);
  const { questionId } = pending;
  pending = null;
  await performSave(questionId);
}

/**
 * 丟棄待保存的變更（ui-contracts A-05 步驟 5）。
 *
 * 套用 AI 產出時使用：伺服端已寫入新內容，此刻若讓排程中的計時器跑完，
 * 送出的會是套用**前**的草稿，不但覆蓋掉剛套用的內容，還會被記成
 * 應試者自行輸入的變更。與 `flushPendingSave` 相反——這裡是刻意不落地。
 */
export function cancelPendingSave(questionId?: string): void {
  if (!pending) return;
  if (questionId !== undefined && pending.questionId !== questionId) return;
  clearTimeout(pending.timer);
  pending = null;
}

/** 測試用：清除計時器與 revision 計數，避免測試之間互相影響。 */
export function resetPersistence(): void {
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
  revisions.clear();
}
