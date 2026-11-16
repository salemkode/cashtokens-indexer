import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { storedHex } from './migration.js';
import { hash, IndexerError, network } from './model.js';

const storageInput = z.object({ path: z.string().min(1), details: z.boolean().default(false) });
const count = z.number().int().nonnegative();
const tables = ['meta', 'blocks', 'transactions', 'outputs', 'movements', 'token_geneses',
  'category_first_seen', 'category_totals', 'holder_balances'];
const blockRow = z.object({ height: count, hash: storedHex.pipe(hash) });

function observeFile(path: string, role: 'database' | 'wal' | 'shm') {
  try {
    const file = statSync(path);
    if (!file.isFile()) throw new IndexerError({ message: 'Storage paths must refer to regular files.' });
    const allocated = count.safeParse(file.blocks);
    return { role, path, state: 'present' as const, apparent_bytes: file.size,
      allocated_bytes: allocated.success ? allocated.data * 512 : null };
  } catch (cause) {
    if (z.object({ code: z.literal('ENOENT') }).safeParse(cause).success) {
      return { role, path, state: 'missing' as const, apparent_bytes: 0, allocated_bytes: 0 };
    }
    if (cause instanceof IndexerError) throw cause;
    throw new IndexerError({ message: 'Could not inspect a database storage file.', cause });
  }
}

function objectPages(db: DatabaseSync) {
  try {
    const rows = z.array(z.object({ name: z.string(), kind: z.enum(['table', 'index']).nullable(),
      pages: count, bytes: count, payload_bytes: count, unused_bytes: count,
    })).parse(db.prepare(`SELECT d.name, s.type AS kind, COUNT(*) AS pages,
      SUM(d.pgsize) AS bytes, SUM(d.payload) AS payload_bytes, SUM(d.unused) AS unused_bytes
      FROM dbstat d LEFT JOIN sqlite_schema s ON s.name = d.name
      GROUP BY d.name, s.type ORDER BY bytes DESC, d.name`).all());
    return { status: 'available' as const, objects: rows };
  } catch (cause) {
    const error = z.object({ message: z.string() }).safeParse(cause);
    if (error.success && /no such table: (?:main\.)?dbstat/i.test(error.data.message)) {
      return { status: 'unavailable' as const, reason: 'This SQLite build does not provide dbstat.' };
    }
    throw new IndexerError({ message: 'Could not inspect SQLite object pages.', cause });
  }
}

function readSnapshot(db: DatabaseSync, details: boolean) {
  db.exec('PRAGMA query_only = ON; BEGIN');
  try {
    const names = new Set(z.array(z.object({ name: z.string() }))
      .parse(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).map(row => row.name));
    if (!tables.every(name => names.has(name))) {
      throw new IndexerError({ message: 'Database is not a supported Blaze token index.' });
    }
    const metaRows = z.array(z.object({ key: z.string(), value: z.string() }))
      .parse(db.prepare('SELECT key, value FROM meta').all());
    const metadata = z.object({ network, start_height: z.coerce.number().int().nonnegative(),
      schema_version: z.enum(['3', '4']),
    }).safeParse(Object.fromEntries(metaRows.map(row => [row.key, row.value])));
    if (!metadata.success) throw new IndexerError({ message: 'Database is not a supported Blaze schema version 3/4 index.' });
    const pageSize = z.object({ page_size: count.positive() }).parse(db.prepare('PRAGMA page_size').get()).page_size;
    const pageCount = z.object({ page_count: count }).parse(db.prepare('PRAGMA page_count').get()).page_count;
    const freePages = z.object({ freelist_count: count }).parse(db.prepare('PRAGMA freelist_count').get()).freelist_count;
    const first = db.prepare('SELECT height, hash FROM blocks ORDER BY height LIMIT 1').get();
    const tip = db.prepare('SELECT height, hash FROM blocks ORDER BY height DESC LIMIT 1').get();
    const detailed = details ? {
      status: 'collected' as const,
      table_rows: Object.fromEntries([...tables, ...['bcmr_publications', 'authchain_steps', 'identity_nodes', 'identity_edges', 'authchain_resolutions'].filter(name => names.has(name))].map(name => [name,
        z.object({ count }).parse(db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()).count,
      ])),
      outputs: z.object({ total: count, live: count, spent: count, unspendable: count }).parse(
        db.prepare(`SELECT COUNT(*) AS total,
          COALESCE(SUM(spent_by IS NULL AND unspendable = 0), 0) AS live,
          COALESCE(SUM(spent_by IS NOT NULL), 0) AS spent,
          COALESCE(SUM(unspendable <> 0), 0) AS unspendable FROM outputs`).get()),
      object_pages: objectPages(db),
    } : { status: 'not_requested' as const, reason: 'Pass --details to scan row counts and table/index pages.' };
    return {
      metadata: metadata.data,
      indexed_range: { first: first === undefined ? null : blockRow.parse(first), tip: tip === undefined ? null : blockRow.parse(tip) },
      sqlite_pages: { page_size_bytes: pageSize, page_count: pageCount, freelist_pages: freePages,
        logical_database_bytes: pageCount * pageSize,
        used_page_bytes: (pageCount - freePages) * pageSize,
        reusable_page_bytes: freePages * pageSize },
      details: detailed,
    };
  } finally { db.exec('ROLLBACK'); }
}

/** Inspect existing storage without changing rows, checkpointing WAL, or compacting files. */
export function inspectStorage(input: z.input<typeof storageInput>) {
  const options = storageInput.parse(input);
  const path = resolve(options.path);
  const existing = observeFile(path, 'database');
  if (existing.state === 'missing') throw new IndexerError({ message: 'Database file does not exist; no file was created.' });
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const snapshot = (() => {
      try { return readSnapshot(db, options.details); }
      finally { db.close(); }
    })();
    const files = [observeFile(path, 'database'), observeFile(`${path}-wal`, 'wal'), observeFile(`${path}-shm`, 'shm')];
    const allocations = z.array(count).safeParse(files.map(file => file.allocated_bytes));
    return {
      observed_at: new Date().toISOString(),
      ...snapshot,
      files,
      observed_file_bytes: files.reduce((total, file) => total + file.apparent_bytes, 0),
      observed_allocated_bytes: allocations.success ? allocations.data.reduce((total, bytes) => total + bytes, 0) : null,
      notes: [
        'This is observed index storage, not an estimate of the entire BCH chain or future capacity.',
        'Logical database pages, filesystem files, and WAL are different measurements; do not add logical bytes to file bytes.',
        'Freelist pages are reusable inside SQLite and remain allocated; no VACUUM or checkpoint was requested.',
        'SQL values share a read transaction; filesystem sizes are later observations and may change while a writer runs.',
        'SQLite readers may participate in WAL shared-memory locking; this tool requests no database writes or maintenance.',
        'BCHN blocks, chainstate, txindex, remote storage, backups, and filesystem snapshots are outside this report.',
      ],
    };
  } catch (cause) {
    if (cause instanceof IndexerError) throw cause;
    throw new IndexerError({ message: 'Could not read the existing token database in read-only mode.', cause });
  }
}
