import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { hash, hex, IndexerError } from './model.js';

// Binary fields are decoded once at the SQLite boundary; REST retains its existing hex contract.
export const storedHex = z.preprocess(value => value instanceof Uint8Array
  ? Buffer.from(value).toString('hex') : value, hex);
export function binary(value: string) { return Buffer.from(value, 'hex'); }

const binaryColumns = {
  blocks: ['hash', 'previous_hash'], transactions: ['txid'],
  outputs: ['txid', 'category', 'commitment', 'script', 'spent_by'],
  movements: ['txid', 'category'], token_geneses: ['category', 'txid'],
  category_first_seen: ['category', 'txid'], category_totals: ['category'],
  holder_balances: ['category', 'script'],
};

export function migrateBinary(db: DatabaseSync, version: string | null) {
  if (version !== '3') return;
  // SQLite stores BLOBs losslessly even in columns originally declared with TEXT affinity.
  // All keys change together; disable FK enforcement only outside this migration transaction.
  db.function('blaze_binary', { deterministic: true }, value => binary(hex.parse(value)));
  db.function('blaze_hash', { deterministic: true }, value => binary(hash.parse(value)));
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
  try {
    for (const [table, columns] of Object.entries(binaryColumns)) {
      for (const column of columns) {
        const convert = ['script', 'commitment'].includes(column) ? 'blaze_binary' : 'blaze_hash';
        db.exec(`UPDATE ${table} SET ${column} = ${convert}(${column}) WHERE typeof(${column}) = 'text'`);
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new IndexerError({ message: 'Migration found inconsistent foreign keys; original database preserved' });
    }
    db.prepare("UPDATE meta SET value = '4' WHERE key = 'schema_version'").run();
    // Existing blocks were not inspected for metadata-only transitions. Never imply otherwise.
    db.prepare("INSERT OR REPLACE INTO meta VALUES ('authchain_scan_start', ?)")
      .run(String(Number(z.object({ height: z.number().nullable() }).parse(
        db.prepare('SELECT MAX(height) AS height FROM blocks').get()).height ?? -1) + 1));
    db.exec('COMMIT');
  } catch (cause) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw new IndexerError({ message: 'Schema 3 to 4 migration failed; original data retained', cause });
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}
