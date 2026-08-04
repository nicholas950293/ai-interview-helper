import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, type Db } from './client.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

/**
 * 依檔名順序套用尚未執行的遷移。每個遷移在單一交易中完成，
 * 失敗時整份回滾，不留下半套 schema。
 */
export function runMigrations(db: Db = getDb()): string[] {
  ensureMigrationsTable(db);

  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migration')
      .all()
      .map((row) => (row as { name: string }).name)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const executed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migration (name) VALUES (?)').run(file);
    });
    apply.immediate();
    executed.push(file);
  }

  return executed;
}

// `npm run db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const executed = runMigrations();
  if (executed.length === 0) {
    console.log('[db] 無待執行的遷移，schema 已是最新。');
  } else {
    console.log(`[db] 已套用 ${executed.length} 個遷移：${executed.join(', ')}`);
  }
}
