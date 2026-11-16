import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { IndexerError, rpcBlock } from '../src/model.js';
import { BitcoinRpc } from '../src/rpc.js';
import { TokenStore } from '../src/store.js';
import { syncOnce } from '../src/sync.js';

function digest(value: number) {
  return value.toString(16).padStart(64, '0');
}
function block(height: number, id: number, parent?: number) {
  return { height, hash: digest(id), time: height + 1700000000, tx: [],
    ...(parent === undefined ? {} : { previousblockhash: digest(parent) }) };
}
function mockNode(initial: z.input<typeof rpcBlock>[], chain = 'regtest') {
  const state = { blocks: initial, chain, reads: 0, changeAfterDownload: false };
  return {
    state,
    async call(method: string, params: unknown[] = []) {
      if (method === 'getblockchaininfo') {
        return { chain: state.chain, blocks: state.blocks.length - 1, pruned: false };
      }
      if (method === 'getblockhash') {
        const [height] = z.tuple([z.number()]).parse(params);
        const result = state.blocks[height];
        if (result === undefined) throw new IndexerError({ message: 'No such block' });
        return result.hash;
      }
      if (method === 'getblock') {
        const [hash, verbosity] = z.tuple([z.string(), z.number()]).parse(params);
        assert.equal(verbosity, 2);
        const result = state.blocks.find(value => value.hash === hash);
        if (result === undefined) throw new IndexerError({ message: 'No such block' });
        state.reads += 1;
        if (state.changeAfterDownload && result.height > 0) {
          state.blocks[result.height] = block(result.height, 100 + result.height, result.height);
        }
        return result;
      }
      throw new IndexerError({ message: 'Unexpected method' });
    },
  };
}
function memoryStore(startHeight = 0, network: 'mainnet' | 'chipnet' | 'regtest' = 'regtest') {
  return new TokenStore({ path: ':memory:', network, startHeight });
}

test('synchronizes in bounded passes, persists identity, and is idempotent', async t => {
  const store = memoryStore();
  t.after(() => store.close());
  const rpc = mockNode([block(0, 1), block(1, 2, 1), block(2, 3, 2)]);
  const first = await syncOnce(store, rpc, { maxBlocks: 2 });
  assert.equal(first.indexed, 2);
  assert.equal(first.tip?.height, 1);
  assert.equal(store.getMeta('genesis_hash'), digest(1));
  const second = await syncOnce(store, rpc, { maxBlocks: 2 });
  assert.equal(second.indexed, 1);
  assert.equal(second.tip?.height, 2);
  assert.equal((await syncOnce(store, rpc)).indexed, 0);
  assert.equal(rpc.state.reads, 3);
});

test('reconciles an equal-height fork and then a shorter canonical chain', async t => {
  const store = memoryStore();
  t.after(() => store.close());
  const rpc = mockNode([block(0, 1), block(1, 2, 1), block(2, 3, 2)]);
  await syncOnce(store, rpc);
  rpc.state.blocks = [block(0, 1), block(1, 20, 1), block(2, 30, 20)];
  const fork = await syncOnce(store, rpc);
  assert.equal(fork.rolledBack, 2);
  assert.equal(fork.indexed, 2);
  assert.equal(fork.tip?.hash, digest(30));
  rpc.state.blocks = [block(0, 1), block(1, 20, 1)];
  const shorter = await syncOnce(store, rpc);
  assert.equal(shorter.rolledBack, 1);
  assert.equal(shorter.indexed, 0);
  assert.equal(shorter.tip?.hash, digest(20));
});

test('large rollback is bounded and resumes next pass', async t => {
  const store = memoryStore();
  t.after(() => store.close());
  const rpc = mockNode([block(0, 1), block(1, 2, 1), block(2, 3, 2), block(3, 4, 3)]);
  await syncOnce(store, rpc);
  rpc.state.blocks = [block(0, 1), block(1, 20, 1), block(2, 30, 20), block(3, 40, 30)];
  const first = await syncOnce(store, rpc, { maxBlocks: 2 });
  assert.equal(first.rolledBack, 2);
  assert.equal(first.indexed, 0);
  const second = await syncOnce(store, rpc);
  assert.equal(second.rolledBack, 1);
  assert.equal(second.tip?.hash, digest(40));
});

test('refuses chipnet/testnet4 confusion and genesis changes', async t => {
  const chip = memoryStore(0, 'chipnet');
  const store = memoryStore();
  t.after(() => chip.close());
  t.after(() => store.close());
  const wrong = mockNode([block(0, 1)], 'test4');
  await assert.rejects(syncOnce(chip, wrong), /Expected BCHN chain chip/);
  wrong.state.chain = 'chip';
  await assert.rejects(syncOnce(chip, wrong), /post-fork checkpoint/);
  const rpc = mockNode([block(0, 1)]);
  await assert.rejects(syncOnce(store, rpc, { expectedGenesisHash: digest(100) }), /EXPECTED_GENESIS_HASH/);
  await syncOnce(store, rpc);
  rpc.state.blocks = [block(0, 10)];
  await assert.rejects(syncOnce(store, rpc), /genesis differs/);
  assert.equal(store.tip()?.hash, digest(1));
});

test('anchors a partial scan and refuses reorganization before it', async t => {
  const store = memoryStore(2);
  t.after(() => store.close());
  const rpc = mockNode([block(0, 1), block(1, 2, 1), block(2, 3, 2)]);
  await syncOnce(store, rpc);
  assert.deepEqual(store.anchor(), { height: 1, hash: digest(2) });
  rpc.state.blocks = [block(0, 1), block(1, 20, 1), block(2, 30, 20)];
  await assert.rejects(syncOnce(store, rpc), /before START_HEIGHT/);
  assert.equal(store.tip()?.hash, digest(3));
});

test('does not commit a block replaced during download', async t => {
  const store = memoryStore();
  t.after(() => store.close());
  const rpc = mockNode([block(0, 1), block(1, 2, 1)]);
  rpc.state.changeAfterDownload = true;
  await assert.rejects(syncOnce(store, rpc), /Chain changed while downloading/);
  assert.equal(store.tip()?.height, 0);
});

test('rejects pruned required history and inconsistent block responses', async t => {
  const store = memoryStore();
  t.after(() => store.close());
  const rpc = mockNode([block(0, 1)]);
  const pruned = {
    async call(method: string, params: unknown[] = []) {
      if (method === 'getblockchaininfo') return { chain: 'regtest', blocks: 10, pruned: true, pruneheight: 5 };
      return rpc.call(method, params);
    },
  };
  await assert.rejects(syncOnce(store, pruned), /history is pruned/);
  const inconsistent = {
    async call(method: string, params: unknown[] = []) {
      if (method === 'getblock') return block(1, 1);
      return rpc.call(method, params);
    },
  };
  await assert.rejects(syncOnce(store, inconsistent), /different block than requested/);
  assert.equal(store.tip(), null);
});

test('RPC uses Basic auth, refreshes cookies, and rejects mutating methods', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blaze-rpc-'));
  const cookieFile = join(directory, '.cookie');
  await writeFile(cookieFile, '__cookie__:first');
  const calls = [{ authorization: '', method: '' }];
  const server = createServer(async (request, response) => {
    const chunks = [''];
    for await (const chunk of request) chunks.push(String(chunk));
    const body = z.object({ id: z.string(), method: z.string() }).parse(JSON.parse(chunks.join('')));
    calls.push({ authorization: request.headers.authorization ?? '', method: body.method });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: body.id, error: null, result: { chain: 'regtest' } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await rm(directory, { recursive: true });
  });
  const address = z.object({ port: z.number() }).parse(server.address());
  const rpc = new BitcoinRpc({ url: `http://username:password@127.0.0.1:${address.port}`, cookieFile });
  assert.deepEqual(await rpc.call('getblockchaininfo'), { chain: 'regtest' });
  await writeFile(cookieFile, '__cookie__:second');
  await rpc.call('getblockhash', [0]);
  assert.equal(calls[1]?.authorization, `Basic ${Buffer.from('__cookie__:first').toString('base64')}`);
  assert.equal(calls[2]?.authorization, `Basic ${Buffer.from('__cookie__:second').toString('base64')}`);
  await assert.rejects(rpc.call('sendrawtransaction', ['00']));
  assert.equal(calls.length, 3);
});

test('RPC errors redact server messages and credentials', async t => {
  const server = createServer(async (request, response) => {
    const chunks = [''];
    for await (const chunk of request) chunks.push(String(chunk));
    const body = z.object({ id: z.string() }).parse(JSON.parse(chunks.join('')));
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: body.id, error: { code: -1, message: 'secret-password' }, result: null }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = z.object({ port: z.number() }).parse(server.address());
  const rpc = new BitcoinRpc({ url: `http://secret-user:secret-password@127.0.0.1:${address.port}` });
  await assert.rejects(rpc.call('getblockchaininfo'), error => {
    assert.ok(error instanceof IndexerError);
    assert.match(error.message, /code -1/);
    assert.doesNotMatch(JSON.stringify(error), /secret/);
    return true;
  });
});

test('RPC times out once and does not follow an authenticated redirect', async t => {
  const state = { requests: 0, redirect: false };
  const server = createServer((_request, response) => {
    state.requests += 1;
    if (state.redirect) {
      response.writeHead(307, { location: '/unexpected' });
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = z.object({ port: z.number() }).parse(server.address());
  const rpc = new BitcoinRpc({ url: `http://127.0.0.1:${address.port}`, timeoutMs: 100 });
  await assert.rejects(rpc.call('getblockchaininfo'), /request failed/);
  assert.equal(state.requests, 1);
  state.redirect = true;
  await assert.rejects(rpc.call('getblockchaininfo'), /request failed/);
  assert.equal(state.requests, 2);
});

test('mainnet checkpoint rejects BTC/BSV despite their shared genesis and chain name', async () => {
  const store = new TokenStore({ path: ':memory:', network: 'mainnet', startHeight: 792773 });
  try {
    const rpc = { async call(method: string) {
      if (method === 'getblockchaininfo') return { chain: 'main', blocks: 900000, pruned: false };
      if (method === 'getblockhash') return 'f'.repeat(64);
      throw new IndexerError({ message: 'Unexpected RPC call' });
    } };
    await assert.rejects(syncOnce(store, rpc), /not on Bitcoin Cash mainnet/);
    assert.equal(store.tip(), null);
  } finally { store.close(); }
});


test('Chipnet identity requires its post-fork hash independently of shared genesis or chain labels', async t => {
  const store = memoryStore(115253, 'chipnet');
  t.after(() => store.close());
  const state = { checkpoint: '00000000ae25e85d9e22cd6c8d72c2f5d4b0222289d801b7f633aeae3f8c6367' };
  const rpc = { async call(method: string, params: unknown[] = []) {
    if (method === 'getblockchaininfo') return { chain: 'chip', blocks: 115252, pruned: false, initialblockdownload: false };
    if (method === 'getblockhash') return params[0] === 0 ? '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b' : state.checkpoint;
    throw new IndexerError({ message: 'Unexpected fixture read' });
  } };
  await assert.rejects(syncOnce(store, rpc), /post-fork checkpoint differs/);
  assert.equal(store.getMeta('genesis_hash'), null);
  state.checkpoint = '00000000040ba9641ba98a37b2e5ceead38e4e2930ac8f145c8094f94c708727';
  assert.equal((await syncOnce(store, rpc)).indexed, 0);
  assert.equal(store.getMeta('genesis_hash'), '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b');
  assert.equal(store.status().chain_checkpoint?.hash, state.checkpoint);
});

test('RPC rejects oversized upstream bodies before accepting parsed data', async t => {
  const server = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end('x'.repeat(10000)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const rpc = new BitcoinRpc({ url: `http://127.0.0.1:${address.port}`, maxResponseBytes: 100 });
  await assert.rejects(rpc.call('getblockchaininfo'), /byte limit/);
});
