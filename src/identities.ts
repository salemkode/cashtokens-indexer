import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { IndexerError, rpcBlock } from './model.js';
import { binary, storedHex } from './migration.js';
import { parsePublication } from './authchain.js';

const rowSchema = z.object({ txid: storedHex, height: z.number(), timestamp: z.number(), depth: z.number(),
  script: storedHex, satoshis: z.string(), token_category: storedHex.nullable(), amount: z.string().nullable(),
  capability: z.enum(['none', 'mutable', 'minting']).nullable(), commitment: storedHex.nullable(),
  publication: storedHex.nullable(), burned: z.number(), previous_txid: storedHex });
const prefix = /^6a(?:04|4c04|4d0400|4e04000000)42434d52/;

export function setupIdentities(db: DatabaseSync, startHeight: number) {
  const version = db.prepare("SELECT value FROM meta WHERE key='identity_index_version'").get()?.value;
  if (version !== undefined && version !== '1') throw new IndexerError({ message: 'Unsupported metadata identity index version' });
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS identity_nodes (
      txid BLOB PRIMARY KEY, height INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
      script BLOB NOT NULL, satoshis TEXT NOT NULL, token_category BLOB, amount TEXT,
      capability TEXT, commitment BLOB, publication BLOB, burned INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identity_edges (
      previous_txid BLOB PRIMARY KEY REFERENCES identity_nodes(txid) ON DELETE CASCADE,
      txid BLOB NOT NULL REFERENCES identity_nodes(txid) ON DELETE CASCADE,
      height INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS identity_edges_height ON identity_edges(height);
    CREATE INDEX IF NOT EXISTS identity_nodes_height ON identity_nodes(height);
  `);
  try {
    if (version === undefined) {
      const tip = z.object({ height: z.number().nullable() }).parse(db.prepare('SELECT MAX(height) AS height FROM blocks').get());
      db.prepare("INSERT INTO meta VALUES ('identity_scan_start', ?)").run(String(tip.height === null ? startHeight : tip.height + 1));
      db.prepare("INSERT INTO meta VALUES ('identity_index_version', '1')").run();
    }
    db.exec('COMMIT');
  } catch (cause) { if (db.isTransaction) db.exec('ROLLBACK'); throw cause; }
}

/** Shared identity nodes/edges avoid copying overlapping publication chains per authbase. */
export function indexIdentities(db: DatabaseSync, block: z.infer<typeof rpcBlock>, registered: string[]) {
  const byId = new Map(block.tx.map(tx => [tx.txid, tx]));
  const spenders = new Map(block.tx.flatMap(tx => tx.vin.flatMap(input =>
    'txid' in input && input.vout === 0 ? [[input.txid, tx.txid] as const] : [])));
  const queue = new Array<string>();
  const insert = db.prepare('INSERT OR IGNORE INTO identity_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  function remember(txid: string) {
    const tx = byId.get(txid);
    if (tx === undefined) throw new IndexerError({ message: 'Missing identity transaction in node block' });
    const identity = tx.vout.find(output => output.n === 0);
    if (identity === undefined) throw new IndexerError({ message: 'Identity transaction has no output 0' });
    const publication = tx.vout.filter(output => prefix.test(output.scriptPubKey.hex)).sort((a, b) => a.n - b.n)[0]?.scriptPubKey.hex;
    const token = identity.tokenData;
    insert.run(binary(txid), block.height, binary(identity.scriptPubKey.hex),
      BigInt(identity.value.toFixed(8).replace('.', '')).toString(), token === undefined ? null : binary(token.category),
      token?.amount ?? null, token?.nft?.capability ?? null, token?.nft === undefined ? null : binary(token.nft.commitment),
      publication === undefined ? null : binary(publication),
      Number(identity.scriptPubKey.hex.startsWith('6a') || identity.scriptPubKey.hex.length > 20000));
    queue.push(txid);
  }
  for (const tx of block.tx) {
    if (registered.includes(tx.txid) || tx.vout.some(output => prefix.test(output.scriptPubKey.hex))) remember(tx.txid);
  }
  const consumed = [...spenders.keys()];
  for (const batch of Array.from({ length: Math.ceil(consumed.length / 500) }, (_, index) => consumed.slice(index * 500, index * 500 + 500))) {
    for (const row of db.prepare(`SELECT txid FROM identity_nodes WHERE txid IN (${batch.map(() => '?').join(',')})`).all(...batch.map(binary))) {
      queue.push(z.object({ txid: storedHex }).parse(row).txid);
    }
  }
  const visited = new Set<string>();
  while (queue.length > 0) {
    const previous = queue.shift();
    if (previous === undefined || visited.has(previous)) continue;
    visited.add(previous);
    const next = spenders.get(previous);
    if (next === undefined) continue;
    remember(next);
    db.prepare('INSERT INTO identity_edges VALUES (?, ?, ?)').run(binary(previous), binary(next), block.height);
  }
}

export function readIdentity(db: DatabaseSync, authbase: string, page: { limit: number; offset: number },
  status: { identity_scan_start: number; tip: { height: number; hash: string } | null }) {
  const walk = `WITH RECURSIVE chain(txid, previous_txid, depth) AS (
      SELECT txid, txid, 0 FROM identity_nodes WHERE txid = ?
      UNION ALL SELECT e.txid, c.txid, c.depth+1 FROM chain c JOIN identity_edges e ON e.previous_txid=c.txid
      LIMIT 10001
    )`;
  // Walk only compact link identifiers; do not load every historical script/publication to find a head.
  const headRaw = db.prepare(`${walk} SELECT n.*, b.timestamp, c.depth, c.previous_txid FROM chain c
    JOIN identity_nodes n ON n.txid=c.txid JOIN blocks b USING(height) ORDER BY c.depth DESC LIMIT 1`).get(binary(authbase));
  const head = headRaw === undefined ? undefined : rowSchema.parse(headRaw);
  const root = db.prepare('SELECT publication IS NOT NULL AS available FROM identity_nodes WHERE txid=?').get(binary(authbase));
  const limited = head !== undefined && db.prepare('SELECT 1 FROM identity_edges WHERE previous_txid = ?').get(binary(head.txid)) !== undefined;
  const complete = status.identity_scan_start === 0 && !limited;
  const coverage = { status: complete ? 'complete' as const : 'incomplete' as const,
    scan_start: status.identity_scan_start, indexed_height: status.tip?.height ?? null, indexed_tip: status.tip,
    reason: complete ? null : limited ? 'Identity traversal exceeds 10000 links; narrow the requested base.'
      : 'Historical identity data was not inspected before the scan boundary.',
    root_publication_available: root?.available === 1 };
  if (head === undefined) return { category: authbase, status: 'incomplete' as const,
    coverage: { ...coverage, status: 'incomplete' as const },
    reason: 'Authbase not observed. Publication roots are automatic; configure AUTHCHAIN_BASES before rescanning other identities.' };
  const latestRaw = db.prepare(`${walk} SELECT n.txid, n.publication FROM chain c JOIN identity_nodes n ON n.txid=c.txid
    WHERE n.publication IS NOT NULL ORDER BY c.depth DESC LIMIT 1`).get(binary(authbase));
  const latest = latestRaw === undefined ? undefined : z.object({ txid: storedHex, publication: storedHex }).parse(latestRaw);
  const rows = db.prepare(`${walk} SELECT n.*, b.timestamp, c.depth, c.previous_txid FROM chain c
    JOIN identity_nodes n ON n.txid=c.txid JOIN blocks b USING(height) ORDER BY c.depth DESC LIMIT ? OFFSET ?`)
    .all(binary(authbase), page.limit, page.offset).map(row => rowSchema.parse(row));
  return { category: authbase, status: !complete ? 'incomplete' as const : head.burned ? 'burned' as const : 'tracked' as const,
    discovery_only: true as const, authbase, coverage, head_state: head.burned ? 'burned' as const : 'unspent_at_indexed_tip' as const,
    authhead: { txid: head.txid, output_index: 0 as const, height: head.height, timestamp: head.timestamp,
      locking_bytecode: head.script, value_satoshis: head.satoshis, token_category: head.token_category,
      fungible_token_amount: head.amount, nonfungible_token_capability: head.capability, nonfungible_token_commitment: head.commitment },
    authchain_length: head.depth, latest_publication: latest === undefined ? null : { txid: latest.txid, ...parsePublication(latest.publication) },
    publication_history_complete: complete, metadata_content_verified: false as const,
    revisions: rows.map(row => ({ txid: row.txid, previous_txid: row.depth === 0 ? null : row.previous_txid,
      height: row.height, timestamp: row.timestamp, migration_index: row.depth, publication: parsePublication(row.publication) })),
  };
}
