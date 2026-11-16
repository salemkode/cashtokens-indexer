import { createTestBroadcast } from './test-broadcast.js';
import { createReadProxy } from './rpc-proxy.js';
import { statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { acquireWriter } from './ownership.js';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { createApi } from './api.js';
import { configSchema } from './config.js';
import { IndexerError } from './model.js';
import { BitcoinRpc, ScopedTestRpc } from './rpc.js';
import { TokenStore } from './store.js';
import { syncOnce } from './sync.js';

async function main() {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report keys, never values: configuration contains RPC credentials.
    console.error('Invalid configuration:', parsed.error.issues.map(issue => issue.path.join('.')).join(', '));
    process.exitCode = 1;
    return;
  }
  const release = acquireWriter(parsed.data.DATABASE_PATH);
  try { await serve(parsed.data); } finally { release(); }
}

async function serve(config: z.infer<typeof configSchema>) {
  const controller = new AbortController();
  const store = new TokenStore({ path: config.DATABASE_PATH, network: config.NETWORK, startHeight: config.START_HEIGHT, undoDepth: config.UNDO_DEPTH, authbases: config.AUTHCHAIN_BASES });
  const rpc = new BitcoinRpc({ url: config.BCH_RPC_URL, username: config.BCH_RPC_USER,
    password: config.BCH_RPC_PASSWORD, cookieFile: config.BCH_RPC_COOKIE_FILE, maxResponseBytes: config.RPC_MAX_RESPONSE_BYTES, timeoutMs: config.RPC_TIMEOUT_MS }, controller.signal);
  // Token extraction needs retained blocks, not txindex. Historical BCH serving
  // can use a different archival node, or be omitted on a token-only host.
  const historyRpc = config.SERVE_BCH_API ? (config.BCH_HISTORY_RPC_URL === undefined ? rpc : new BitcoinRpc({
    url: config.BCH_HISTORY_RPC_URL, username: config.BCH_HISTORY_RPC_USER,
    password: config.BCH_HISTORY_RPC_PASSWORD, cookieFile: config.BCH_HISTORY_RPC_COOKIE_FILE,
    maxResponseBytes: config.RPC_MAX_RESPONSE_BYTES, timeoutMs: config.RPC_TIMEOUT_MS,
  }, controller.signal)) : undefined;
  const proxy = config.RPC_PROXY_PORT === undefined ? undefined : createReadProxy(historyRpc ?? rpc, config.NETWORK);
  const gateway = config.TEST_RPC_PORT === undefined ? undefined : (() => {
    const test = z.object({ NETWORK: z.enum(['chipnet', 'regtest']), BCH_TEST_RPC_URL: z.url(), TEST_APPROVAL_FILE: z.string() }).parse(config);
    const client = new ScopedTestRpc({ url: test.BCH_TEST_RPC_URL, username: config.BCH_TEST_RPC_USER,
      password: config.BCH_TEST_RPC_PASSWORD, cookieFile: config.BCH_TEST_RPC_COOKIE_FILE, maxResponseBytes: config.RPC_MAX_RESPONSE_BYTES, timeoutMs: config.RPC_TIMEOUT_MS }, test.NETWORK, controller.signal);
    return createTestBroadcast(client, test.TEST_APPROVAL_FILE, `${config.DATABASE_PATH}.test-submissions.sqlite`);
  })();
  const app = await createApi({ store, corsOrigins: config.CORS_ORIGINS, rpc: historyRpc, tokenRpc: rpc });
  const runtime = z.object({
    state: z.enum(['starting', 'syncing', 'synced', 'error', 'stopping']), source_height: z.number().nullable(),
    last_success_at: z.string().nullable(), last_error: z.string().nullable(), node_ready: z.boolean(),
  }).parse({ state: 'starting', source_height: null, last_success_at: null, last_error: null, node_ready: false });
  app.get('/readyz', (_request, reply) => {
    const tip = store.tip();
    const fresh = runtime.last_success_at !== null && Date.now() - Date.parse(runtime.last_success_at) <= config.MAX_SYNC_AGE_MS;
    const ready = runtime.state === 'synced' && runtime.node_ready && fresh && !controller.signal.aborted
      && tip !== null && tip.height === runtime.source_height;
    return reply.code(ready ? 200 : 503).send({ ...store.status(), ...runtime });
  });
  function shutdown() { runtime.state = 'stopping'; controller.abort(); }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    if (proxy !== undefined) {
      const address = await proxy.listen({ host: '127.0.0.1', port: config.RPC_PROXY_PORT });
      console.log(JSON.stringify({ event: 'read_rpc_listening', address, network: config.NETWORK }));
    }
    if (gateway !== undefined) {
      const address = await gateway.listen({ host: '127.0.0.1', port: config.TEST_RPC_PORT });
      console.log(JSON.stringify({ event: 'approved_test_rpc_listening', address, network: config.NETWORK }));
    }
    await app.listen({ host: config.HOST, port: config.PORT });
    console.log(JSON.stringify({ event: 'listening', host: config.HOST, port: config.PORT, network: config.NETWORK }));
    while (!controller.signal.aborted) {
      try {
        function storageGuard() {
          const space = statfsSync(dirname(config.DATABASE_PATH));
          if (space.bavail * space.bsize < config.MIN_FREE_BYTES) {
            throw new IndexerError({ message: 'Free storage is below MIN_FREE_BYTES; indexing paused before commit' });
          }
        }
        storageGuard();
        const result = await syncOnce(store, rpc, { maxBlocks: config.SYNC_BATCH_SIZE, expectedGenesisHash: config.EXPECTED_GENESIS_HASH }, storageGuard);
        runtime.node_ready = result.nodeReady;
        runtime.source_height = result.sourceHeight;
        runtime.last_success_at = new Date().toISOString();
        runtime.last_error = null;
        runtime.state = result.tip?.height === result.sourceHeight ? 'synced' : 'syncing';
        if (result.indexed > 0 || result.rolledBack > 0) console.log(JSON.stringify({ event: 'sync', ...result }));
        if (runtime.state === 'syncing' && (result.indexed > 0 || result.rolledBack > 0)) {
          // Yield to HTTP requests even while catching up through empty historical blocks.
          await setTimeout(0, undefined, { signal: controller.signal });
          continue;
        }
      } catch (cause) {
        if (controller.signal.aborted) break;
        runtime.state = 'error';
        runtime.last_error = cause instanceof IndexerError ? cause.message :
          cause instanceof z.ZodError ? 'BCH node response validation failed' : 'Synchronization failed';
        console.error(JSON.stringify({ event: 'sync_error', message: runtime.last_error }));
      }
      try { await setTimeout(config.POLL_INTERVAL_MS, undefined, { signal: controller.signal }); }
      catch { if (controller.signal.aborted) break; }
    }
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await app.close();
    await proxy?.close();
    await gateway?.close();
    store.close();
  }
}

main().catch(() => {
  console.error('Indexer startup failed. Check configuration, database access, and port availability.');
  process.exitCode = 1;
});
