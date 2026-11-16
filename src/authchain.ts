import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { IndexerError, rpcBlock } from './model.js';
import { binary, storedHex } from './migration.js';

const publicationPrefix = /^6a(?:04|4c04|4d0400|4e04000000)42434d52/;
const stepRow = z.object({
  category: storedHex, txid: storedHex, previous_txid: storedHex, height: z.number(), depth: z.number(),
  script: storedHex, satoshis: z.string(), token_category: storedHex.nullable(), amount: z.string().nullable(),
  capability: z.enum(['none', 'mutable', 'minting']).nullable(), commitment: storedHex.nullable(),
  publication: storedHex.nullable(), burned: z.number(), timestamp: z.number(),
});

/** Decode data pushes only. Unknown opcodes, truncation and invalid UTF-8 stay invalid publications. */
function pushes(script: string) {
  const bytes = Buffer.from(script, 'hex');
  const cursor = { offset: 1 };
  const values = new Array<Buffer>();
  while (cursor.offset < bytes.length) {
    const opcode = bytes[cursor.offset++];
    if (opcode === undefined) return null;
    const lengthBytes = opcode === 76 ? 1 : opcode === 77 ? 2 : opcode === 78 ? 4 : 0;
    if (opcode > 78 || (opcode > 75 && lengthBytes === 0)) return null;
    if (cursor.offset + lengthBytes > bytes.length) return null;
    const size = lengthBytes === 0 ? opcode : bytes.readUIntLE(cursor.offset, lengthBytes);
    cursor.offset += lengthBytes;
    if (size > bytes.length - cursor.offset) return null;
    values.push(bytes.subarray(cursor.offset, cursor.offset + size));
    cursor.offset += size;
  }
  return values;
}

export function parsePublication(script: string | null) {
  if (script === null) return { status: 'none' as const };
  const chunks = pushes(script);
  if (chunks === null || chunks[0]?.toString('hex') !== '42434d52' || chunks[1]?.length !== 32) {
    return { status: 'invalid' as const, locking_bytecode: script };
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const uris = chunks.slice(2).map(value => decoder.decode(value));
    return { status: 'published' as const, locking_bytecode: script,
      content_hash: chunks[1].toString('hex'), uris, content_verified: false as const };
  } catch { return { status: 'invalid' as const, locking_bytecode: script }; }
}

export function setupAuthchains(db: DatabaseSync, migratedTip: number | null) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bcmr_publications (
      txid BLOB PRIMARY KEY, height INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
      script BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS authchain_steps (
      category BLOB NOT NULL, txid BLOB NOT NULL, previous_txid BLOB NOT NULL,
      height INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE, depth INTEGER NOT NULL,
      script BLOB NOT NULL, satoshis TEXT NOT NULL, token_category BLOB, amount TEXT,
      capability TEXT, commitment BLOB, publication BLOB, burned INTEGER NOT NULL,
      PRIMARY KEY(category, depth)
    );
    CREATE INDEX IF NOT EXISTS authchain_steps_height ON authchain_steps(height);
    CREATE INDEX IF NOT EXISTS authchain_steps_txid ON authchain_steps(txid);
  `);
  if (migratedTip !== null && db.prepare("SELECT 1 FROM meta WHERE key = 'authchain_scan_start'").get() === undefined) {
    db.prepare("INSERT INTO meta VALUES ('authchain_scan_start', ?)").run(String(migratedTip + 1));
  }
}

export function indexAuthchains(db: DatabaseSync, block: z.infer<typeof rpcBlock>) {
  const publication = (tx: z.infer<typeof rpcBlock>['tx'][number]) => tx.vout
    .filter(output => publicationPrefix.test(output.scriptPubKey.hex)).sort((a, b) => a.n - b.n)[0]?.scriptPubKey.hex;
  for (const tx of block.tx) {
    const script = publication(tx);
    if (script !== undefined) db.prepare('INSERT INTO bcmr_publications VALUES (?, ?, ?)')
      .run(binary(tx.txid), block.height, binary(script));
  }
  const spenders = new Map(block.tx.flatMap(tx => tx.vin.flatMap(input =>
    'txid' in input && input.vout === 0 ? [[input.txid, tx] as const] : [])));
  const seeds = new Map<string, { txid: string; depth: number }>();
  const consumed = [...spenders.keys()];
  const heads = Array.from({ length: Math.ceil(consumed.length / 500) }, (_, index) => consumed.slice(index * 500, index * 500 + 500))
    .flatMap(batch => db.prepare(`SELECT s.category, s.txid, s.depth FROM authchain_steps s
      WHERE s.txid IN (${batch.map(() => '?').join(',')}) AND NOT EXISTS
        (SELECT 1 FROM authchain_steps n WHERE n.category = s.category AND n.depth > s.depth)`)
      .all(...batch.map(binary)));
  for (const raw of heads) {
    const head = z.object({ category: storedHex, txid: storedHex, depth: z.number() }).parse(raw);
    // Only identities consumed in this block need further work.
    if (spenders.has(head.txid)) seeds.set(head.category, head);
  }
  for (const raw of db.prepare(`SELECT g.category FROM token_geneses g JOIN transactions t USING(txid)
    WHERE t.height = ?`).all(block.height)) {
    const { category } = z.object({ category: storedHex }).parse(raw);
    seeds.set(category, { txid: category, depth: 0 });
  }
  const insert = db.prepare('INSERT INTO authchain_steps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const [category, seed] of seeds) {
    const current = { ...seed };
    const visited = new Set<string>();
    while (spenders.has(current.txid)) {
      const tx = spenders.get(current.txid);
      if (tx === undefined) break;
      if (visited.has(tx.txid)) throw new IndexerError({ message: 'Cyclic authchain in node block' });
      visited.add(tx.txid);
      const identity = tx.vout.find(output => output.n === 0);
      if (identity === undefined) throw new IndexerError({ message: 'Authchain transaction has no identity output' });
      const token = identity.tokenData;
      const published = publication(tx);
      const burned = identity.scriptPubKey.hex.startsWith('6a') || identity.scriptPubKey.hex.length > 20000;
      insert.run(binary(category), binary(tx.txid), binary(current.txid), block.height, current.depth + 1,
        binary(identity.scriptPubKey.hex), BigInt(identity.value.toFixed(8).replace('.', '')).toString(),
        token === undefined ? null : binary(token.category), token?.amount ?? null, token?.nft?.capability ?? null,
        token?.nft === undefined ? null : binary(token.nft.commitment),
        published === undefined ? null : binary(published), Number(burned));
      current.txid = tx.txid;
      current.depth += 1;
    }
  }
}

export function readAuthchain(db: DatabaseSync, category: string, page: { limit: number; offset: number },
  status: { start_height: number; authchain_scan_start: number; tip: { height: number; hash: string } | null }) {
  const headRaw = db.prepare(`SELECT s.*, b.timestamp FROM authchain_steps s JOIN blocks b USING(height)
    WHERE category = ? ORDER BY depth DESC LIMIT 1`).get(binary(category));
  const coverage = { status: status.authchain_scan_start === 0 && status.start_height === 0 ? 'complete' as const : 'incomplete' as const,
    scan_start: status.authchain_scan_start, indexed_height: status.tip?.height ?? null, indexed_tip: status.tip,
    reason: status.authchain_scan_start === 0 && status.start_height === 0 ? null
      : 'Pre-scan authbase publications or pre-migration metadata-only spends were not inspected.',
    root_publication_available: db.prepare('SELECT 1 FROM bcmr_publications WHERE txid = ?').get(binary(category)) !== undefined };
  if (headRaw === undefined) return { category, status: 'incomplete' as const, coverage: { ...coverage, status: 'incomplete' as const },
    reason: 'Genesis/authchain not observed in this scan; rescan from activation (or genesis) for complete tracking.' };
  const head = stepRow.parse(headRaw);
  const latestRaw = db.prepare(`SELECT publication, txid FROM authchain_steps
    WHERE category = ? AND publication IS NOT NULL ORDER BY depth DESC LIMIT 1`).get(binary(category));
  const rootRaw = db.prepare('SELECT script AS publication, txid FROM bcmr_publications WHERE txid = ?').get(binary(category));
  const latest = latestRaw ?? rootRaw;
  const published = latest === undefined ? null : z.object({ publication: storedHex, txid: storedHex }).parse(latest);
  const revisions = db.prepare(`SELECT s.*, b.timestamp FROM authchain_steps s JOIN blocks b USING(height)
    WHERE category = ? ORDER BY depth DESC LIMIT ? OFFSET ?`).all(binary(category), page.limit, page.offset)
    .map(raw => {
      const step = stepRow.parse(raw);
      return { txid: step.txid, previous_txid: step.previous_txid, height: step.height, timestamp: step.timestamp,
        migration_index: step.depth, publication: parsePublication(step.publication) };
    });
  return { category, status: coverage.status === 'incomplete' ? 'incomplete' as const : head.burned ? 'burned' as const : 'tracked' as const,
    head_state: head.burned ? 'burned' as const : 'unspent_at_indexed_tip' as const, discovery_only: true as const, coverage,
    authbase: category, authhead: { txid: head.txid, output_index: 0, height: head.height, timestamp: head.timestamp,
      locking_bytecode: head.script, value_satoshis: head.satoshis, token_category: head.token_category,
      fungible_token_amount: head.amount, nonfungible_token_capability: head.capability,
      nonfungible_token_commitment: head.commitment },
    authchain_length: head.depth, latest_publication: published === null ? null : {
      txid: published.txid, ...parsePublication(published.publication) },
    // Absence cannot prove that a pre-scan authbase did not publish metadata.
    publication_history_complete: status.authchain_scan_start === 0,
    revisions, metadata_content_verified: false as const,
  };
}
