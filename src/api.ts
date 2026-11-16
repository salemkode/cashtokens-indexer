import { activityEnvelope } from './activity-contract.js';
import { activityPage } from './activity.js';
import { resolveAuthbase } from './authchain-resolution.js';
import { verifyRegistry } from './metadata.js';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { z } from 'zod';
import { authchainEnvelope } from './authchain-contract.js';
import { registerBchRoutes } from './bch.js';
import type { BitcoinRpc } from './rpc.js';
import { hash, hex, page, rpcTransaction, IndexerError } from './model.js';
import type { TokenStore } from './store.js';

const categoryParam = z.object({ category: hash });
const scriptParam = z.object({ script: hex.refine(value => value.length > 0 && value.length <= 20000) });
const utxoPage = page.extend({
  nft: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  capability: z.enum(['none', 'mutable', 'minting']).optional(),
});
export async function createApi(options: {
  store: TokenStore;
  corsOrigins: string[];
  rpc?: Pick<BitcoinRpc, 'call'>;
  tokenRpc?: Pick<BitcoinRpc, 'call'>;
}) {
  const { store } = options;
  const app = Fastify({ bodyLimit: 128000, logger: false, connectionTimeout: 15000, requestTimeout: 30000,
    keepAliveTimeout: 5000, forceCloseConnections: true, routerOptions: { maxParamLength: 20000 } });
  await app.register(cors, {
    origin: options.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid request parameters.' });
    }
    const status = z.object({ statusCode: z.number().int().min(400).max(499) }).safeParse(error);
    if (status.success) return reply.code(status.data.statusCode).send({ error: 'Invalid request.' });
    return reply.code(500).send({ error: 'Indexer request failed.' });
  });
  const envelope = <T>(data: T) => ({ network: store.network, confirmed_only: true, indexed_height: store.tip()?.height ?? null, data });
  app.get('/healthz', () => ({ status: 'ok', network: store.network, confirmed_only: true }));
  app.get('/v1/status', () => store.status());
  app.get('/v1/activity', (request, reply) => {
    const pagination = activityPage.parse(request.query);
    const snapshot = store.tip();
    if (pagination.snapshot_hash !== undefined && pagination.snapshot_hash !== snapshot?.hash) {
      return reply.code(409).send({ error: 'Activity snapshot changed; restart pagination at the new committed tip.' });
    }
    const result = activityEnvelope.safeParse({ ...envelope(store.activity(pagination)), snapshot, coverage: { start_height: store.startHeight,
      token_state: store.status().token_coverage, gross_fungible_details_start: Number(store.getMeta('activity_detail_start')) },
      order: 'block_height_desc,transaction_position_desc,txid_asc', metadata_only_authchain_events: 'excluded' });
    if (!result.success) throw new IndexerError({ message: 'Activity response does not satisfy v1 contract' });
    return result.data;
  });
  app.get('/v1/tokens', request => envelope(store.listCategories(page.parse(request.query))));
  app.get('/v1/tokens/:category', (request, reply) => {
    const { category } = categoryParam.parse(request.params);
    const token = store.category(category);
    if (!token) return reply.code(404).send({ error: 'Token category not found.' });
    return envelope(token);
  });
  app.get('/v1/tokens/:category/supply', (request, reply) => {
    const { category } = categoryParam.parse(request.params);
    const summary = store.category(category);
    if (summary === null) return reply.code(404).send({ error: 'Token category not found.' });
    const chain = store.authchain(category);
    const head = chain.authhead;
    const reserve = head === undefined ? null : chain.head_state === 'burned' || head.token_category !== category
      ? '0' : head.fungible_token_amount;
    const genesis = store.genesisLocation(category);
    return envelope({ category, spendable_fungible_supply: summary.fungible_supply,
      reserved_fungible_supply: reserve, circulating_fungible_supply: reserve === null ? null
        : (BigInt(summary.fungible_supply) - BigInt(reserve)).toString(),
      initial_spendable_supply: genesis?.initial_spendable_supply ?? null,
      initial_spendable_nfts: genesis?.initial_spendable_nfts ?? null,
      nft_count: summary.nft_count, minting_count: summary.minting_count,
      reserve_basis: 'Indexed unspent identity output 0 on the category authchain; no issuer trust assertion.',
      reserve_known: head !== undefined, authchain_status: chain.status });
  });
  app.get('/v1/tokens/:category/genesis', async (request, reply) => {
    const { category } = categoryParam.parse(request.params);
    const location = store.genesisLocation(category);
    if (location === null) return reply.code(409).send({ error: 'Verified genesis was not observed in this scan.' });
    const rpc = options.tokenRpc ?? options.rpc;
    if (rpc === undefined) return envelope({ ...location, outputs: null, availability: 'node_required' });
    try {
      const canonical = hash.parse(await rpc.call('getblockhash', [location.height]));
      if (canonical !== location.block_hash) return reply.code(503).send({ error: 'Indexed genesis is no longer canonical; wait for synchronization.' });
      const tx = rpcTransaction.parse(await rpc.call('getrawtransaction', [location.txid, true, location.block_hash]));
      if (tx.txid !== location.txid) throw new IndexerError({ message: 'Genesis transaction hash differs' });
      const outputs = tx.vout.filter(output => output.tokenData?.category === category).map(output => ({
        output_index: output.n, locking_bytecode: output.scriptPubKey.hex,
        value_satoshis: BigInt(output.value.toFixed(8).replace('.', '')).toString(), token: output.tokenData,
        unspendable: output.scriptPubKey.hex.startsWith('6a') || output.scriptPubKey.hex.length > 20000,
      }));
      return envelope({ ...location, outputs, availability: 'available' });
    } catch { return reply.code(502).send({ error: 'Genesis data is unavailable from the retained node.' }); }
  });
  app.get('/v1/tokens/:category/authchain', request => {
    const { category } = categoryParam.parse(request.params);
    const result = authchainEnvelope.safeParse(envelope(store.resolved(category, page.parse(request.query)) ?? store.authchain(category, page.parse(request.query))));
    if (!result.success) throw new IndexerError({ message: 'Authchain response does not satisfy v1 contract' });
    return result.data;
  });
  app.get('/v1/authchains/:authbase', request => {
    const { authbase } = z.object({ authbase: hash }).parse(request.params);
    const result = authchainEnvelope.safeParse(envelope(store.resolved(authbase, page.parse(request.query)) ?? store.identity(authbase, page.parse(request.query))));
    if (!result.success) throw new IndexerError({ message: 'Identity response does not satisfy v1 contract' });
    return result.data;
  });
  app.get('/v1/tokens/:category/utxos', request => {
    const { category } = categoryParam.parse(request.params);
    return envelope(store.listOutputs({ category, ...utxoPage.parse(request.query) }));
  });
  app.get('/v1/tokens/:category/holders', request => {
    const { category } = categoryParam.parse(request.params);
    return envelope(store.holders(category, page.parse(request.query)));
  });
  app.get('/v1/tokens/:category/transactions', request => {
    const { category } = categoryParam.parse(request.params);
    return envelope(store.history(category, page.parse(request.query)));
  });
  app.get('/v1/scripts/:script/tokens', request => {
    const { script } = scriptParam.parse(request.params);
    return envelope(store.balances(script, page.parse(request.query)));
  });
  app.get('/v1/scripts/:script/utxos', request => {
    const { script } = scriptParam.parse(request.params);
    return envelope(store.listOutputs({ scripts: [script], ...utxoPage.parse(request.query) }));
  });
  const resolutionJobs = new Set<string>();
  app.post('/v1/authchains/:authbase/resolve', async (request, reply) => {
    const { authbase } = z.object({ authbase: hash }).parse(request.params);
    const { max_blocks } = z.object({ max_blocks: z.number().int().min(1).max(100).default(10) }).parse(request.body);
    const rpc = options.tokenRpc ?? options.rpc;
    if (rpc === undefined) return reply.code(503).send({ error: 'Retained native node is required for identity resolution.' });
    if (resolutionJobs.size >= 2 || resolutionJobs.has(authbase)) return reply.code(429).send({ error: 'Identity resolution capacity is busy.' });
    resolutionJobs.add(authbase);
    try {
      const progress = await resolveAuthbase(store.db, rpc, authbase, { maxBlocks: max_blocks, network: store.network,
        genesis: store.getMeta('genesis_hash'), tip: store.tip() }, () => store.tip());
      return reply.code(progress.state === 'complete' ? 200 : 202).send(envelope(progress));
    } catch { return reply.code(502).send({ error: 'Bounded native identity resolution unavailable; check retained history, txindex and chain snapshot.' }); }
    finally { resolutionJobs.delete(authbase); }
  });
  // Verified byte cache is bounded and keyed by content digest, never by a mutable identity name.
  const content = new Map<string, Buffer>();
  const contentBudget = { bytes: 0 };
  function publicationFor(authbase: string) {
    const categoryChain = store.resolved(authbase) ?? store.authchain(authbase);
    const chain = categoryChain.authhead === undefined ? store.identity(authbase) : categoryChain;
    return chain.latest_publication;
  }
  app.get('/v1/authchains/:authbase/metadata', (request, reply) => {
    const { authbase } = z.object({ authbase: hash }).parse(request.params);
    const publication = publicationFor(authbase);
    if (publication?.status !== 'published') return envelope({ status: 'no_valid_publication', publication });
    const bytes = content.get(publication.content_hash);
    return envelope(bytes === undefined ? { status: 'content_required', publication,
      submit_to: `/v1/authchains/${authbase}/metadata/verify` }
      : verifyRegistry(bytes, publication.content_hash));
  });
  app.post('/v1/authchains/:authbase/metadata/verify', { bodyLimit: 1500000 }, (request, reply) => {
    const { authbase } = z.object({ authbase: hash }).parse(request.params);
    const { content_base64 } = z.object({ content_base64: z.string().max(1398104)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).parse(request.body);
    const publication = publicationFor(authbase);
    if (publication?.status !== 'published') return reply.code(409).send({ error: 'No structurally valid indexed publication is available.' });
    const bytes = Buffer.from(content_base64, 'base64');
    if (bytes.length > 1048576) return reply.code(413).send({ error: 'Registry exceeds one MiB.' });
    const result = verifyRegistry(bytes, publication.content_hash);
    if (result.status === 'verified_content' && !content.has(publication.content_hash)) {
      content.set(publication.content_hash, bytes);
      contentBudget.bytes += bytes.length;
      while (contentBudget.bytes > 16777216 || content.size > 128) {
        const oldest = content.keys().next().value;
        if (oldest === undefined) break;
        contentBudget.bytes -= content.get(oldest)?.length ?? 0;
        content.delete(oldest);
      }
    }
    return envelope(result);
  });
  if (options.rpc !== undefined) registerBchRoutes(app, { rpc: options.rpc, network: store.network });
  return app;
}
