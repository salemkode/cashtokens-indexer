import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { IndexerError } from './model.js';

const ownerSchema = z.object({ pid: z.number().int().positive(), nonce: z.uuid(), created_at: z.string() });

export function acquireWriter(database: string) {
  const path = `${resolve(database)}.writer-lock`;
  mkdirSync(dirname(path), { recursive: true });
  const owner = { pid: process.pid, nonce: randomUUID(), created_at: new Date().toISOString() };
  try {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(owner)); }
    catch (cause) {
      if (existsSync(path) && statSync(path).ino === fstatSync(fd).ino) unlinkSync(path);
      throw cause;
    } finally { closeSync(fd); }
  } catch {
    throw new IndexerError({ message: 'Database writer lock exists or cannot be created. Stop the owning service; use db:unlock only for a verified dead owner.' });
  }
  return function release() {
    if (!existsSync(path)) return;
    const current = ownerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (current.nonce !== owner.nonce) throw new IndexerError({ message: 'Database writer ownership changed; refusing to remove foreign lock' });
    unlinkSync(path);
  };
}

/** Operator recovery only; PID reuse/permission uncertainty fail closed. Never clear a live owner's lock. */
export function clearDeadWriter(database: string) {
  const path = `${resolve(database)}.writer-lock`;
  const before = statSync(path);
  const owner = ownerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  try { process.kill(owner.pid, 0); }
  catch (cause) {
    const error = z.object({ code: z.literal('ESRCH') }).safeParse(cause);
    if (!error.success) throw new IndexerError({ message: 'Cannot establish that writer is dead; lock retained' });
    const current = statSync(path);
    if (before.ino !== current.ino || before.mtimeMs !== current.mtimeMs) {
      throw new IndexerError({ message: 'Writer lock changed during recovery; lock retained' });
    }
    unlinkSync(path);
    return { cleared: true, previous_pid: owner.pid };
  }
  throw new IndexerError({ message: 'Writer process is alive; refusing to clear lock' });
}
