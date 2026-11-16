import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { hash, IndexerError } from './model.js';
import { binary, storedHex } from './migration.js';

export const activityPage = z.object({ limit: z.coerce.number().int().min(1).max(100).default(9),
  offset: z.coerce.number().int().min(0).max(10000000).default(0), snapshot_hash: hash.optional() });

export function setupActivity(db: DatabaseSync, startHeight: number) {
  const version = db.prepare("SELECT value FROM meta WHERE key='activity_index_version'").get()?.value;
  if (version !== undefined && version !== '1') throw new IndexerError({ message: 'Unsupported activity index version' });
  if (version === '1') {
    z.object({ value: z.string().regex(/^(0|[1-9][0-9]*)$/) }).parse(db.prepare("SELECT value FROM meta WHERE key='activity_detail_start'").get());
    const columns = new Set(db.prepare('PRAGMA table_info(movements)').all().map(row => row.name));
    if (!columns.has('fungible_issued') || !columns.has('fungible_burned')) throw new IndexerError({ message: 'Activity schema metadata is inconsistent' });
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(movements)').all().map(row => row.name));
    for (const name of ['fungible_issued', 'fungible_burned']) {
      if (!columns.has(name)) db.exec(`ALTER TABLE movements ADD COLUMN ${name} TEXT`);
    }
    const tip = z.object({ height: z.number().nullable() }).parse(db.prepare('SELECT MAX(height) AS height FROM blocks').get());
    db.prepare("INSERT OR REPLACE INTO meta VALUES ('activity_detail_start', ?)").run(String(tip.height === null ? startHeight : tip.height + 1));
    db.prepare("INSERT OR REPLACE INTO meta VALUES ('activity_index_version', '1')").run();
    db.exec('COMMIT');
  } catch (cause) { if (db.isTransaction) db.exec('ROLLBACK'); throw cause; }
}

export function readActivity(db: DatabaseSync, input: z.infer<typeof activityPage>) {
  const rows = db.prepare(`SELECT t.txid, t.height, t.position, b.hash AS block_hash, b.timestamp FROM transactions t
    JOIN blocks b USING(height) WHERE EXISTS (SELECT 1 FROM movements m WHERE m.txid=t.txid)
    ORDER BY t.height DESC, t.position DESC, t.txid ASC LIMIT ? OFFSET ?`).all(input.limit, input.offset);
  const movements = db.prepare(`SELECT category, fungible_delta, nft_delta, fungible_issued, fungible_burned,
    EXISTS (SELECT 1 FROM token_geneses g WHERE g.category=movements.category) AS genesis_observed
    FROM movements WHERE txid=? ORDER BY category`);
  return rows.map(raw => {
    const row = z.object({ txid: storedHex, height: z.number(), position: z.number(), block_hash: storedHex, timestamp: z.number() }).parse(raw);
    const categories = movements.all(binary(row.txid)).map(value => {
      const movement = z.object({ category: storedHex, fungible_delta: z.string(), nft_delta: z.number(),
        fungible_issued: z.string().nullable(), fungible_burned: z.string().nullable(), genesis_observed: z.number() }).parse(value);
      return { category: movement.category, fungible_delta: movement.fungible_delta, nft_delta: movement.nft_delta,
        fungible_issued: movement.fungible_issued, fungible_burned: movement.fungible_burned,
        category_history_complete: movement.genesis_observed === 1,
        gross_fungible_details_complete: movement.fungible_issued !== null && movement.fungible_burned !== null };
    });
    return { txid: row.txid, transaction_position: row.position,
      block: { height: row.height, hash: row.block_hash, timestamp: row.timestamp }, categories };
  });
}
