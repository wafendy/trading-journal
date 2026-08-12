/**
 * Backup script — writes a single, consistent copy of the SQLite database using
 * SQLite's online-backup API. Safe to run while the app is running, and WAL-safe:
 * the output file has all committed data merged in, with no -wal/-shm sidecars, so
 * it can be copied to another instance as-is.
 *
 * Commands:
 *   npm run db:backup                 → ./backups/trading-<UTC timestamp>.db
 *   npm run db:backup -- ./my.db      → explicit output path
 *
 * Source DB is DB_PATH (default ./trading.db), matching the app and seed scripts.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH ?? './trading.db';

// First non-flag arg is an explicit destination; otherwise a timestamped file under ./backups.
const outArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = resolve(outArg ?? `./backups/trading-${stamp}.db`);

mkdirSync(dirname(outPath), { recursive: true });

const src = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const before = src.prepare('SELECT count(*) AS n FROM trades').get() as { n: number };
  await src.backup(outPath);
  console.log(`Backed up ${before.n} trades from ${dbPath} → ${outPath}`);
} finally {
  src.close();
}
