import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, linkSync, mkdirSync, openSync, closeSync, fsyncSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IndexerError } from './model.js';
import { acquireWriter } from './ownership.js';

export function validateBackup(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new IndexerError({ message: 'Database integrity validation failed' });
    }
    const tables = new Set(z.array(z.object({ name: z.string() })).parse(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()).map(row => row.name));
    if (!['blocks', 'transactions', 'outputs', 'movements', 'category_first_seen', 'category_totals', 'holder_balances', 'token_geneses'].every(name => tables.has(name))) {
      throw new IndexerError({ message: 'Backup is not a complete Blaze database' });
    }
    const metadata = Object.fromEntries(z.array(z.object({ key: z.string(), value: z.string() }))
      .parse(db.prepare('SELECT key, value FROM meta').all()).map(row => [row.key, row.value]));
    return z.object({ schema_version: z.enum(['3', '4']), network: z.enum(['mainnet', 'chipnet', 'regtest']),
      start_height: z.coerce.number().int().nonnegative() }).parse(metadata);
  } finally { db.close(); }
}

/** SQLite online backup includes committed WAL contents; never copy only the live main file. */
export async function backupDatabase(source: string, destination: string) {
  const input = resolve(source);
  const output = resolve(destination);
  if (input === output || !existsSync(input) || existsSync(output)) {
    throw new IndexerError({ message: 'Backup needs an existing source and a different unused destination' });
  }
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.partial`;
  const db = new DatabaseSync(input, { readOnly: true });
  const owned = { partial: false };
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    owned.partial = true;
    closeSync(fd);
    await backup(db, temporary, { rate: 128 });
    chmodSync(temporary, 0o600);
    const metadata = validateBackup(temporary);
    const snapshot = new DatabaseSync(temporary);
    try { snapshot.exec('PRAGMA journal_mode = DELETE'); } finally { snapshot.close(); }
    const file = openSync(temporary, 'r');
    try { fsyncSync(file); } finally { closeSync(file); }
    // A hard link is atomic and fails if a destination appeared meanwhile; never overwrite.
    linkSync(temporary, output);
    const directory = openSync(dirname(output), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return { database: output, metadata };
  } finally {
    db.close();
    if (owned.partial) for (const path of [temporary, `${temporary}-wal`, `${temporary}-shm`]) rmSync(path, { force: true });
  }
}

export async function restoreDatabase(source: string, destination: string) {
  validateBackup(resolve(source));
  if (existsSync(resolve(destination))) {
    throw new IndexerError({ message: 'Restore only accepts a new destination; retain the old database for recovery' });
  }
  const release = acquireWriter(destination);
  try { return await backupDatabase(source, destination); }
  finally { release(); }
}
