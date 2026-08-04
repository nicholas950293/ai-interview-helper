import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getEnv } from '../lib/env.js';

export type Db = Database.Database;

let instance: Db | null = null;

function open(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function getDb(): Db {
  instance ??= open(getEnv().DATABASE_PATH);
  return instance;
}

/** 測試用：以獨立的記憶體資料庫取代預設連線。 */
export function setDb(db: Db): void {
  instance = db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
