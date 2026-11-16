import { chipnetCheckpoint, chipnetGenesis } from './network.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hash, hex, IndexerError, network, token } from './model.js';
import { RpcResponseError, type BitcoinRpc } from './rpc.js';

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000000).default(0),
});
// BCHN getblockstats amounts are BCH decimals (unlike Bitcoin Core's satoshi fields).
const statsAmount = z.number().finite().nonnegative()
  .max(21000000, 'Aggregate BCH amount is too large for exact decimal normalization')
  .transform(value => satoshis(value));
const chainInfo = z.object({ chain: z.string(), blocks: z.number().int().nonnegative() });
const header = z.object({ hash, height: z.number().int().nonnegative(), time: z.number().int().nonnegative(),
  nTx: z.number().int().nonnegative().optional(), confirmations: z.number().int().optional() });
const enrichedOutput = z.object({ value: z.number().finite().nonnegative().max(21000000),
  scriptPubKey: z.object({ hex }), tokenData: token.optional() });
const input = z.union([
  z.object({ txid: hash, vout: z.number().int().nonnegative(), scriptSig: z.object({ hex }).optional(),
    value: enrichedOutput.shape.value.optional(), scriptPubKey: enrichedOutput.shape.scriptPubKey.optional(),
    tokenData: token.optional(), prevout: enrichedOutput.optional() }),
  z.object({ coinbase: hex }),
]);
const output = z.object({ n: z.number().int().nonnegative(),
  value: z.number().finite().nonnegative().max(21000000), scriptPubKey: z.object({ hex }), tokenData: token.optional() });
const transaction = z.object({ txid: hash, size: z.number().int().nonnegative().optional(), hex: hex.optional(),
  vin: z.array(input), vout: z.array(output), blockhash: hash.optional(), time: z.number().int().nonnegative().optional(),
  confirmations: z.number().int().optional(), fee: z.number().finite().optional() });
const blockData = header.extend({ size: z.number().int().nonnegative(), tx: z.array(transaction) });
const blockOverview = header.extend({ size: z.number().int().nonnegative(), tx: z.array(hash) });
const blockStats = z.object({ totalfee: statsAmount });
const mempool = z.record(hash, z.object({ time: z.number().int().nonnegative() }));
const expectedChains = { mainnet: 'main', chipnet: 'chip', regtest: 'regtest' };
const activation = { height: 792773, hash: '000000000000000002fc0cdadaef1857bbd2936d37ea94f80ba3db4a5e8353e8' };

function nodeValue<T extends z.ZodType>(schema: T, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new IndexerError({ message: 'BCH node returned invalid data' });
  return parsed.data;
}

function bytea(value: string) { return `\\x${value}`; }
function satoshis(value: number) { return BigInt(value.toFixed(8).replace('.', '')).toString(); }
function outputView(value: z.infer<typeof output>) {
  return {
    output_index: value.n,
    token_category: value.tokenData === undefined ? null : bytea(value.tokenData.category),
    fungible_token_amount: value.tokenData?.amount ?? null,
    nonfungible_token_capability: value.tokenData?.nft?.capability ?? null,
    nonfungible_token_commitment: value.tokenData?.nft === undefined ? null : bytea(value.tokenData.nft.commitment),
    locking_bytecode: bytea(value.scriptPubKey.hex), value_satoshis: satoshis(value.value),
  };
}

async function concurrentMap<T, U>(values: T[], run: (value: T) => Promise<U>) {
  const pending = values.map((value, index) => ({ value, index }));
  const results = new Map<number, U>();
  await Promise.all(Array.from({ length: Math.min(values.length, 8) }, async () => {
    while (pending.length > 0) {
      const item = pending.shift();
      if (item) results.set(item.index, await run(item.value));
    }
  }));
  return values.map((_, index) => {
    const result = results.get(index);
    if (result === undefined) throw new IndexerError({ message: 'Incomplete BCH RPC batch' });
    return result;
  });
}

export function registerBchRoutes(app: FastifyInstance, options: {
  rpc: Pick<BitcoinRpc, 'call'>;
  network: z.infer<typeof network>;
}) {
  const rpc = options.rpc;
  const selectedNetwork = network.parse(options.network);
  const slots = { active: 0 };
  const waiting = new Array<() => void>();
  async function read(method: string, params: unknown[]) {
    if (slots.active < 8) slots.active += 1;
    else {
      if (waiting.length >= 256) throw new IndexerError({ message: 'BCH RPC request queue is full' });
      await new Promise<void>(resolve => waiting.push(resolve));
    }
    try { return await rpc.call(method, params); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else slots.active -= 1;
    }
  }
  // Only immutable transaction bodies are retained: confirmation state is fetched anew.
  const prevouts = new Map<string, Promise<z.infer<typeof transaction>>>();
  const metadata = new Map<string, { expires: number; value: Promise<unknown> }>();
  const largeReads = new Map<string, Promise<unknown>>();
  const prevoutSizes = new Map<string, number>();
  const prevoutBudget = { bytes: 0 };
  const projections = new Map<string, { bytes: number; value: Promise<z.infer<typeof blockData>> }>();
  const projectionBudget = { bytes: 0 };
  async function decodedBlock(blockHash: string) {
    const existing = projections.get(blockHash);
    if (existing) return existing.value;
    const entry = { bytes: 0, value: read('getblock', [blockHash, 3]).catch(cause => {
      if (!(cause instanceof RpcResponseError) || ![-1, -8, -32602].includes(cause.code)) throw cause;
      return read('getblock', [blockHash, 2]);
    }).then(raw => nodeValue(blockData, raw)) };
    if (projections.size < 2) projections.set(blockHash, entry);
    try {
      const value = await entry.value;
      if (value.hash !== blockHash) throw new IndexerError({ message: 'RPC block hash differs' });
      entry.bytes = Buffer.byteLength(JSON.stringify(value));
      if (projections.get(blockHash) === entry) projectionBudget.bytes += entry.bytes;
      while (projections.size > 2 || projectionBudget.bytes > 16000000) {
        const oldest = projections.keys().next().value;
        if (oldest === undefined) break;
        projectionBudget.bytes -= projections.get(oldest)?.bytes ?? 0;
        projections.delete(oldest);
      }
      return value;
    } catch (cause) {
      if (projections.get(blockHash) === entry) projections.delete(blockHash);
      throw cause;
    }
  }
  async function rawTransaction(txid: string, blockHash?: string) {
    try { return nodeValue(transaction, await read('getrawtransaction', [txid, 2, ...(blockHash === undefined ? [] : [blockHash])])); }
    catch (cause) {
      // Older nodes and missing native input data have an explicit legacy fallback.
      if (!(cause instanceof RpcResponseError) || ![-1, -8, -32602].includes(cause.code)) throw cause;
      return nodeValue(transaction, await read('getrawtransaction', [txid, true]));
    }
  }
  function forgetPrevout(txid: string) {
    prevouts.delete(txid);
    prevoutBudget.bytes -= prevoutSizes.get(txid) ?? 0;
    prevoutSizes.delete(txid);
  }
  function cached(method: string, params: unknown[], ttl = 2000) {
    const key = JSON.stringify([method, params]);
    // Full blocks and verbose mempools only coalesce while in flight; never retain them after completion.
    if (method === 'getblock' || method === 'getrawmempool') {
      const pending = largeReads.get(key);
      if (pending) return pending;
      const value = read(method, params).finally(() => {
        if (largeReads.get(key) === value) largeReads.delete(key);
      });
      if (largeReads.size < 2) largeReads.set(key, value);
      return value;
    }
    const existing = metadata.get(key);
    if (existing && existing.expires > Date.now()) return existing.value;
    if (metadata.size >= 500) metadata.clear();
    const value = read(method, params).then(raw => {
      const entry = metadata.get(key);
      if (entry?.value === value) entry.expires = Date.now() + ttl;
      return raw;
    }).catch(cause => {
      if (metadata.get(key)?.value === value) metadata.delete(key);
      throw cause;
    });
    metadata.set(key, { expires: Infinity, value });
    return value;
  }
  async function source() {
    const info = nodeValue(chainInfo, await cached('getblockchaininfo', [], 1000));
    if (info.chain !== expectedChains[selectedNetwork]) throw new IndexerError({ message: 'BCH RPC network mismatch' });
    if (selectedNetwork === 'chipnet') {
      if (info.blocks < chipnetCheckpoint.height || nodeValue(hash, await cached('getblockhash', [0], 60000)) !== chipnetGenesis || nodeValue(hash, await cached('getblockhash', [chipnetCheckpoint.height], 60000)) !== chipnetCheckpoint.hash) {
        throw new IndexerError({ message: 'BCH RPC Chipnet post-fork checkpoint mismatch' });
      }
    }
    if (selectedNetwork === 'mainnet' && info.blocks >= activation.height) {
      const checkpoint = nodeValue(hash, await cached('getblockhash', [activation.height], 60000));
      if (checkpoint !== activation.hash) throw new IndexerError({ message: 'BCH RPC activation checkpoint mismatch' });
    }
    return info;
  }
  function prevoutTransaction(txid: string) {
    const existing = prevouts.get(txid);
    if (existing) return existing;
    const value = read('getrawtransaction', [txid, true]).then(raw => {
      const tx = nodeValue(transaction, raw);
      const bytes = Buffer.byteLength(JSON.stringify(tx));
      if (bytes > 4000000) forgetPrevout(txid);
      else if (prevouts.get(txid) === value) {
        prevoutSizes.set(txid, bytes);
        prevoutBudget.bytes += bytes;
        while (prevouts.size > 2000 || prevoutBudget.bytes > 32000000) {
          const oldest = prevouts.keys().next().value;
          if (oldest === undefined) break;
          forgetPrevout(oldest);
        }
      }
      return tx;
    }).catch(() => {
      forgetPrevout(txid);
      throw new IndexerError({ message: 'BCH transaction input data is unavailable' });
    });
    prevouts.set(txid, value);
    return value;
  }
  async function normalizeTransaction(tx: z.infer<typeof transaction>, inclusion?: z.infer<typeof header>,
    blockTransactions?: Map<string, z.infer<typeof transaction>>) {
    const inputs = await concurrentMap(tx.vin, async vin => {
      if ('coinbase' in vin) return { unlocking_bytecode: bytea(vin.coinbase), value_satoshis: '0', outpoint: null };
      const enriched = vin.prevout ?? (vin.value !== undefined && vin.scriptPubKey !== undefined
        ? { value: vin.value, scriptPubKey: vin.scriptPubKey, tokenData: vin.tokenData } : undefined);
      const previousOutput = enriched === undefined
        ? (blockTransactions?.get(vin.txid) ?? await prevoutTransaction(vin.txid)).vout.find(value => value.n === vin.vout)
        : { ...enriched, n: vin.vout };
      if (!previousOutput) throw new IndexerError({ message: 'BCH RPC returned a missing transaction outpoint' });
      const view = outputView(previousOutput);
      return { unlocking_bytecode: bytea(vin.scriptSig?.hex ?? ''), value_satoshis: view.value_satoshis, outpoint: view };
    });
    const outputs = tx.vout.map(outputView);
    const isCoinbase = tx.vin.some(value => 'coinbase' in value);
    const inputValue = inputs.reduce((total, value) => total + BigInt(value.value_satoshis), 0n).toString();
    const outputValue = outputs.reduce((total, value) => total + BigInt(value.value_satoshis), 0n).toString();
    const confirmed = inclusion ?? (tx.blockhash !== undefined && tx.confirmations !== undefined && tx.confirmations > 0
      ? nodeValue(header, await cached('getblockheader', [tx.blockhash, true])) : undefined);
    return { hash: bytea(tx.txid), input_value_satoshis: inputValue, output_value_satoshis: outputValue,
      is_coinbase: isCoinbase, input_count: tx.vin.length, output_count: tx.vout.length,
      size_bytes: tx.size ?? (tx.hex === undefined ? null : tx.hex.length / 2),
      inputs, outputs, block_inclusions: confirmed === undefined ? [] : [{ block: {
        height: confirmed.height, hash: bytea(confirmed.hash), timestamp: confirmed.time,
      } }],
    };
  }
  const blockTotals = new WeakMap<z.infer<typeof blockData>, { totalOutput: bigint; coinbaseValue: bigint | null; inputs: number; outputs: number }>();
  function totalsFor(block: z.infer<typeof blockData>) {
    const existing = blockTotals.get(block);
    if (existing) return existing;
    const coinbase = block.tx.find(tx => tx.vin.some(value => 'coinbase' in value));
    const value = {
      totalOutput: block.tx.reduce((total, tx) => total + tx.vout.reduce((sum, output) => sum + BigInt(satoshis(output.value)), 0n), 0n),
      coinbaseValue: coinbase === undefined ? null : coinbase.vout.reduce((total, output) => total + BigInt(satoshis(output.value)), 0n),
      inputs: block.tx.reduce((total, tx) => total + tx.vin.length, 0),
      outputs: block.tx.reduce((total, tx) => total + tx.vout.length, 0),
    };
    blockTotals.set(block, value);
    return value;
  }
  async function statsFor(blockHash: string) {
    try { return nodeValue(blockStats, await cached('getblockstats', [blockHash, ['totalfee']], 3600000)); }
    catch { return null; }
  }
  function normalizedBlock(value: z.infer<typeof header>, stats: z.infer<typeof blockStats> | null,
    size: number | null = null) {
    // Coinbase may underclaim its reward, so scheduled subsidy cannot prove actual output/generated value.
    return { hash: bytea(value.hash), height: value.height, timestamp: value.time,
      transaction_count: value.nTx ?? null,
      input_count: null,
      output_count: null,
      input_value_satoshis: null,
      output_value_satoshis: null,
      fee_satoshis: stats?.totalfee ?? null, generated_value_satoshis: null,
      // getblockstats.total_size excludes coinbase and header, so cannot substitute for block size.
      size_bytes: size,
    };
  }
  function envelope<T>(data: T, confirmedOnly = true) {
    return { network: selectedNetwork, confirmed_only: confirmedOnly, data };
  }
  function failure(cause: unknown, reply: FastifyReply) {
    if (cause instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid BCH request parameters.' });
    if (cause instanceof RpcResponseError && (cause.code === -5 || cause.code === -8)) {
      return reply.code(404).send({ error: 'Requested BCH object was not found.' });
    }
    return reply.code(502).send({ error: 'BCH node data is unavailable. Check node synchronization and txindex configuration.' });
  }

  app.get('/v1/bch/height', async (_request, reply) => {
    try { return envelope({ height: (await source()).blocks }); }
    catch (cause) { return failure(cause, reply); }
  });
  app.get('/v1/bch/tip', async (_request, reply) => {
    try {
      const info = await source();
      const blockHash = nodeValue(hash, await cached('getblockhash', [info.blocks]));
      const value = nodeValue(header, await cached('getblockheader', [blockHash, true]));
      if (value.hash !== blockHash || value.height !== info.blocks) throw new IndexerError({ message: 'RPC tip does not match requested block' });
      return envelope({ height: value.height, hash: bytea(value.hash), timestamp: value.time });
    } catch (cause) { return failure(cause, reply); }
  });
  app.get('/v1/bch/blocks', async (request, reply) => {
    try {
      const { limit, offset } = pagination.parse(request.query);
      const info = await source();
      const heights = Array.from({ length: Math.min(limit, Math.max(0, info.blocks + 1 - offset)) },
        (_, index) => info.blocks - offset - index);
      const blocks = await concurrentMap(heights, async height => {
        const blockHash = nodeValue(hash, await cached('getblockhash', [height]));
        const value = nodeValue(blockOverview, await cached('getblock', [blockHash, 1]));
        if (value.hash !== blockHash || value.height !== height) throw new IndexerError({ message: 'RPC block does not match requested height' });
        return { ...normalizedBlock(value, null, value.size), transaction_count: value.tx.length };
      });
      return envelope(blocks);
    } catch (cause) { return failure(cause, reply); }
  });
  app.get('/v1/bch/blocks/:heightOrHash', async (request, reply) => {
    try {
      const { heightOrHash } = z.object({ heightOrHash: z.union([hash, z.string().regex(/^(0|[1-9][0-9]*)$/)]) }).parse(request.params);
      const { limit, offset } = pagination.parse(request.query);
      const info = await source();
      const isHash = heightOrHash.length === 64;
      const height = isHash ? null : z.coerce.number().int().nonnegative().safe().parse(heightOrHash);
      if (height !== null && height > info.blocks) return reply.code(404).send({ error: 'Requested BCH block was not found.' });
      const blockHash = isHash ? heightOrHash : nodeValue(hash, await cached('getblockhash', [height]));
      const [block, stats, canonical] = await Promise.all([decodedBlock(blockHash), statsFor(blockHash),
        read('getblockheader', [blockHash, true]).then(raw => nodeValue(header, raw))]);
      if (block.hash !== blockHash || (height !== null && block.height !== height) || (canonical.confirmations === undefined || canonical.confirmations <= 0 || canonical.hash !== blockHash || canonical.height !== block.height)) {
        return reply.code(404).send({ error: 'Requested BCH block is not on the active chain.' });
      }
      // Block data includes every tx body, allowing CTOR same-block prevouts without extra RPC reads.
      const blockTransactions = new Map(block.tx.map(tx => [tx.txid, tx]));
      const transactions = await concurrentMap(block.tx.slice(offset, offset + limit), async tx => ({ transaction: await normalizeTransaction(tx, block, blockTransactions) }));
      const { totalOutput, coinbaseValue, inputs, outputs } = totalsFor(block);
      const generated = coinbaseValue === null || stats === null ? null : coinbaseValue - BigInt(stats.totalfee);
      return envelope({ ...normalizedBlock(block, stats, block.size),
        transaction_count: block.tx.length, input_count: inputs,
        output_count: outputs,
        output_value_satoshis: totalOutput.toString(), generated_value_satoshis: generated?.toString() ?? null,
        input_value_satoshis: generated === null ? null : (totalOutput - generated).toString(), transactions });
    } catch (cause) { return failure(cause, reply); }
  });
  app.get('/v1/bch/transactions/:txid', async (request, reply) => {
    try {
      const { txid } = z.object({ txid: hash }).parse(request.params);
      await source();
      const { block_hash } = z.object({ block_hash: hash.optional() }).parse(request.query);
      const tx = await rawTransaction(txid, block_hash);
      if (tx.txid !== txid) throw new IndexerError({ message: 'RPC transaction does not match requested hash' });
      return envelope(await normalizeTransaction(tx), tx.confirmations !== undefined && tx.confirmations > 0);
    } catch (cause) { return failure(cause, reply); }
  });
  app.get('/v1/bch/transactions', async (request, reply) => {
    try {
      const { ids } = z.object({ ids: z.string().transform(value => value === '' ? [] : value.split(','))
        .pipe(z.array(hash).max(50)) }).parse(request.query);
      await source();
      const unique = [...new Set(ids)];
      const transactions = await concurrentMap(unique, async txid => {
        const tx = await rawTransaction(txid);
        if (tx.txid !== txid) throw new IndexerError({ message: 'RPC transaction does not match requested hash' });
        return normalizeTransaction(tx);
      });
      const byHash = new Map(transactions.map(tx => [tx.hash, tx]));
      return envelope(ids.map(txid => {
        const tx = byHash.get(bytea(txid));
        if (!tx) throw new IndexerError({ message: 'Incomplete BCH transaction batch' });
        return tx;
      }), false);
    } catch (cause) { return failure(cause, reply); }
  });
  const poolState = { expires: 0, requests: new Map<string, Promise<[string, { time: number }][]>>() };
  async function poolEntries() {
    const existing = poolState.requests.get('current');
    if (existing !== undefined && poolState.expires > Date.now()) return existing;
    const pending = read('getrawmempool', [true]).then(raw => Object.entries(nodeValue(mempool, raw))
      .sort(([leftId, left], [rightId, right]) => right.time - left.time || leftId.localeCompare(rightId)));
    poolState.requests.set('current', pending);
    poolState.expires = Infinity;
    try {
      const entries = await pending;
      // A very large native mempool is coalesced only in flight; bounded snapshots expire quickly.
      poolState.expires = Date.now() + (entries.length <= 50000 ? 250 : 0);
      return entries;
    } catch (cause) { poolState.expires = 0; throw cause; }
  }
  app.get('/v1/bch/mempool', async (request, reply) => {
    try {
      const { limit, offset } = pagination.parse(request.query);
      await source();
      const [entries, node] = await Promise.all([poolEntries(), cached('getnetworkinfo', [], 60000)]);
      const userAgent = nodeValue(z.object({ subversion: z.string() }), node).subversion;
      const transactions = await concurrentMap(entries.slice(offset, offset + limit), async ([txid, entry]) => {
        try {
          const tx = await rawTransaction(txid);
          if (tx.txid !== txid) throw new IndexerError({ message: 'RPC mempool transaction does not match requested hash' });
          if (tx.confirmations !== undefined && tx.confirmations > 0) return { status: 'changed' as const, txid };
          return { status: 'available' as const, row: { validated_at: new Date(entry.time * 1000).toISOString(), transaction: await normalizeTransaction(tx) } };
        } catch (cause) {
          if (cause instanceof RpcResponseError && cause.code === -5) return { status: 'changed' as const, txid };
          throw cause;
        }
      });
      return envelope({ name: selectedNetwork, user_agent: userAgent, unconfirmed_transaction_count: entries.length,
        snapshot_consistency: 'best_effort', changed_txids: transactions.flatMap(tx => tx.status === 'changed' ? [tx.txid] : []),
        unconfirmed_transactions: transactions.flatMap(tx => tx.status === 'available' ? [tx.row] : []) }, false);
    } catch (cause) { return failure(cause, reply); }
  });
}
