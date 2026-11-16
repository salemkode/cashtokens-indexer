import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { hash, hex, IndexerError, rpcBlock, rpcTransaction, token } from './model.js';
import { parsePublication } from './authchain.js';
import { binary } from './migration.js';
import { chipnetCheckpoint, chipnetGenesis } from './network.js';
import type { BitcoinRpc } from './rpc.js';

const stepSchema = z.object({ txid: hash, previous_txid: hash.nullable(), height: z.number().int().nonnegative(),
  block_hash: hash, timestamp: z.number(), script: hex, satoshis: z.string(), token: token.nullable(),
  publication: hex.nullable(), burned: z.boolean() });
const payloadSchema = z.object({ steps: z.array(stepSchema).min(1).max(10000),
  scan_height: z.number().int().nonnegative(), scan_hash: hash });
const prefix = /^6a(?:04|4c04|4d0400|4e04000000)42434d52/;

function step(tx: z.infer<typeof rpcTransaction>, block: { height: number; hash: string; time: number }, previous: string | null) {
  const output = tx.vout.find(value => value.n === 0);
  if (output === undefined) throw new IndexerError({ message: 'Identity output 0 is missing' });
  return { txid: tx.txid, previous_txid: previous, height: block.height, block_hash: block.hash, timestamp: block.time,
    script: output.scriptPubKey.hex, satoshis: BigInt(output.value.toFixed(8).replace('.', '')).toString(),
    token: output.tokenData ?? null, publication: tx.vout.filter(value => prefix.test(value.scriptPubKey.hex))
      .sort((a, b) => a.n - b.n)[0]?.scriptPubKey.hex ?? null,
    burned: output.scriptPubKey.hex.startsWith('6a') || output.scriptPubKey.hex.length > 20000 };
}
function advance(payload: z.infer<typeof payloadSchema>, block: z.infer<typeof rpcBlock>) {
  const spenders = new Map(block.tx.flatMap(tx => tx.vin.flatMap(input =>
    'txid' in input && input.vout === 0 ? [[input.txid, tx] as const] : [])));
  const visited = new Set(payload.steps.map(value => value.txid));
  while (true) {
    const head = payload.steps.at(-1);
    if (head === undefined) throw new IndexerError({ message: 'Empty identity resolution' });
    const next = spenders.get(head.txid);
    if (next === undefined) break;
    if (visited.has(next.txid)) throw new IndexerError({ message: 'Cyclic identity resolution' });
    visited.add(next.txid);
    payload.steps.push(step(next, block, head.txid));
  }
}
function save(db: DatabaseSync, base: string, payload: z.infer<typeof payloadSchema>, complete: boolean) {
  const checked = payloadSchema.parse(payload);
  const bytes = JSON.stringify(checked);
  if (Buffer.byteLength(bytes) > 1048576) throw new IndexerError({ message: 'Resolution exceeds one MiB; configure this authbase and rescan the narrow index' });
  const head = checked.steps.at(-1);
  if (head === undefined) throw new IndexerError({ message: 'Missing resolution head' });
  db.prepare(`INSERT INTO authchain_resolutions VALUES (?, ?, ?, ?, ?) ON CONFLICT(authbase) DO UPDATE SET
    head_txid=excluded.head_txid, payload=excluded.payload, complete=excluded.complete, updated_at=excluded.updated_at`)
    .run(binary(base), binary(head.txid), bytes, Number(complete), Date.now());
  db.prepare(`DELETE FROM authchain_resolutions WHERE authbase IN
    (SELECT authbase FROM authchain_resolutions ORDER BY updated_at DESC, authbase LIMIT -1 OFFSET 64)`).run();
}
export function setupResolutions(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS authchain_resolutions (
    authbase BLOB PRIMARY KEY, head_txid BLOB NOT NULL, payload TEXT NOT NULL, complete INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS authchain_resolution_heads ON authchain_resolutions(head_txid);`);
}
export function watchResolutions(db: DatabaseSync, block: z.infer<typeof rpcBlock>) {
  const consumed = [...new Set(block.tx.flatMap(tx => tx.vin.flatMap(input => 'txid' in input && input.vout === 0 ? [input.txid] : [])))];
  for (const batch of Array.from({ length: Math.ceil(consumed.length / 500) }, (_, index) => consumed.slice(index * 500, index * 500 + 500))) {
    const rows = db.prepare(`SELECT hex(authbase) AS authbase, payload FROM authchain_resolutions
      WHERE complete=1 AND head_txid IN (${batch.map(() => '?').join(',')})`).all(...batch.map(binary));
    for (const raw of rows) {
      const row = z.object({ authbase: hash, payload: z.string() }).parse(raw);
      const payload = payloadSchema.parse(JSON.parse(row.payload));
      advance(payload, block);
      payload.scan_height = block.height; payload.scan_hash = block.hash;
      save(db, row.authbase, payload, true);
    }
  }
}
export function readResolution(db: DatabaseSync, base: string, pagination: { limit: number; offset: number },
  tip: { height: number; hash: string } | null) {
  const row = db.prepare('SELECT payload FROM authchain_resolutions WHERE authbase=? AND complete=1').get(binary(base));
  if (row === undefined || tip === null) return null;
  const payload = payloadSchema.parse(JSON.parse(z.object({ payload: z.string() }).parse(row).payload));
  const head = payload.steps.at(-1);
  const root = payload.steps[0];
  if (head === undefined || root === undefined) return null;
  const latest = [...payload.steps].reverse().find(value => value.publication !== null);
  return { category: base, authbase: base, status: head.burned ? 'burned' as const : 'tracked' as const,
    discovery_only: true as const, head_state: head.burned ? 'burned' as const : 'unspent_at_indexed_tip' as const,
    coverage: { status: 'complete' as const, method: 'targeted_native_scan' as const, scan_start: root.height,
      indexed_height: tip.height, indexed_tip: tip, reason: null, root_publication_available: root.publication !== null },
    authhead: { txid: head.txid, output_index: 0 as const, height: head.height, timestamp: head.timestamp,
      locking_bytecode: head.script, value_satoshis: head.satoshis, token_category: head.token?.category ?? null,
      fungible_token_amount: head.token?.amount ?? null, nonfungible_token_capability: head.token?.nft?.capability ?? null,
      nonfungible_token_commitment: head.token?.nft?.commitment ?? null },
    authchain_length: payload.steps.length - 1, publication_history_complete: true, metadata_content_verified: false as const,
    latest_publication: latest === undefined ? null : { txid: latest.txid, ...parsePublication(latest.publication) },
    revisions: [...payload.steps].reverse().slice(pagination.offset, pagination.offset + pagination.limit).map((value, index) => ({
      txid: value.txid, previous_txid: value.previous_txid, height: value.height, timestamp: value.timestamp,
      migration_index: payload.steps.length - 1 - pagination.offset - index, publication: parsePublication(value.publication) })),
  };
}

export async function resolveAuthbase(db: DatabaseSync, rpc: Pick<BitcoinRpc, 'call'>, base: string,
  options: { maxBlocks: number; network: 'mainnet' | 'chipnet' | 'regtest'; genesis: string | null; tip: { height: number; hash: string } | null },
  currentTip: () => { height: number; hash: string } | null) {
  const tip = options.tip;
  if (tip === null || options.genesis === null) throw new IndexerError({ message: 'Wait for an indexed chain snapshot before resolving' });
  const info = z.object({ chain: z.string(), initialblockdownload: z.literal(false) }).parse(await rpc.call('getblockchaininfo'));
  if (info.chain !== { mainnet: 'main', chipnet: 'chip', regtest: 'regtest' }[options.network]
    || hash.parse(await rpc.call('getblockhash', [0])) !== options.genesis
    || hash.parse(await rpc.call('getblockhash', [tip.height])) !== tip.hash) throw new IndexerError({ message: 'Resolution source differs from indexed chain' });
  if (options.network === 'chipnet' && (options.genesis !== chipnetGenesis
    || hash.parse(await rpc.call('getblockhash', [chipnetCheckpoint.height])) !== chipnetCheckpoint.hash)) throw new IndexerError({ message: 'Chipnet resolution checkpoint differs' });
  const existing = db.prepare('SELECT payload, complete FROM authchain_resolutions WHERE authbase=?').get(binary(base));
  if (existing?.complete === 1) return { state: 'complete' as const, scanned_blocks: 0 };
  const payload = await (async () => {
    if (existing !== undefined) {
      const saved = payloadSchema.parse(JSON.parse(z.object({ payload: z.string() }).parse(existing).payload));
      if (hash.parse(await rpc.call('getblockhash', [saved.scan_height])) !== saved.scan_hash) throw new IndexerError({ message: 'Resolution prefix was reorganized; restart the identity resolution' });
      return saved;
    }
    const root = rpcTransaction.extend({ blockhash: hash, confirmations: z.number().int().positive() }).parse(await rpc.call('getrawtransaction', [base, true]));
    if (root.txid !== base) throw new IndexerError({ message: 'Resolved authbase hash differs' });
    const header = z.object({ hash, height: z.number().int().nonnegative(), time: z.number() }).parse(await rpc.call('getblockheader', [root.blockhash, true]));
    if (header.hash !== root.blockhash || header.height > tip.height || hash.parse(await rpc.call('getblockhash', [header.height])) !== header.hash) {
      throw new IndexerError({ message: 'Authbase is not canonical within the indexed snapshot' });
    }
    return { steps: [step(root, header, null)], scan_height: header.height, scan_hash: header.hash };
  })();
  const count = { blocks: 0, complete: false };
  async function terminal() {
    const head = payload.steps.at(-1);
    if (head === undefined) return false;
    if (head.burned) return true;
    const raw = await rpc.call('gettxout', [head.txid, 0, false]);
    if (raw === null) return false;
    const coin = z.object({ bestblock: hash, value: z.number().finite().nonnegative(), scriptPubKey: z.object({ hex }), tokenData: token.optional() }).parse(raw);
    if (coin.scriptPubKey.hex !== head.script || BigInt(coin.value.toFixed(8).replace('.', '')).toString() !== head.satoshis
      || JSON.stringify(coin.tokenData ?? null) !== JSON.stringify(head.token)) throw new IndexerError({ message: 'Resolved identity differs from node UTXO' });
    return true;
  }
  if (await terminal()) count.complete = true;
  // A fresh root also scans its own block: CTOR can place a spender before it.
  const firstHeight = existing === undefined ? payload.scan_height : payload.scan_height + 1;
  for (const height of Array.from({ length: Math.min(options.maxBlocks, Math.max(0, tip.height - firstHeight + 1)) }, (_, index) => firstHeight + index)) {
    if (count.complete) break;
    const blockHash = hash.parse(await rpc.call('getblockhash', [height]));
    const block = rpcBlock.parse(await rpc.call('getblock', [blockHash, 2]));
    if (block.height !== height || block.hash !== blockHash) throw new IndexerError({ message: 'Resolution block differs' });
    advance(payload, block);
    payload.scan_height = height; payload.scan_hash = blockHash; count.blocks += 1;
    if (height === tip.height || await terminal()) count.complete = true;
  }
  const canonical = hash.parse(await rpc.call('getblockhash', [tip.height]));
  if (currentTip()?.hash !== tip.hash || canonical !== tip.hash) {
    throw new IndexerError({ message: 'Indexed chain changed during resolution; repeat bounded reads' });
  }
  save(db, base, payload, count.complete);
  return { state: count.complete ? 'complete' as const : 'resolving' as const, scanned_blocks: count.blocks,
    scanned_height: payload.scan_height, target_height: tip.height };
}
