import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { clearDeadWriter } from '../src/ownership.js';
import { TokenStore } from '../src/store.js';
import { authchainEnvelope } from '../src/authchain-contract.js';
import { alice, block, id, output, tx } from './fixtures.js';

async function waitFor(url: string, code: number, diagnostics = () => '') {
  // Shared development hosts can be compiling other projects; this is a lifecycle assertion, not a startup benchmark.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.status === code) return response;
    } catch { /* Child process may still be starting. */ }
    await setTimeout(25);
  }
  assert.fail(`Service did not return HTTP ${code} for ${url}; ${diagnostics()}`);
}

for (const profile of ['shared', 'separate', 'token-only', 'stale', 'ibd', 'low-disk', 'crash']) {
test(`service starts and stops with ${profile} RPC configuration`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blaze-main-'));
  const nodeState = { failing: false, stalled: false, ibd: profile === 'ibd' };
  const historyCalls = new Array<{ method: string; authorization: string }>();
  const rpc = createServer(async (request, response) => {
    const chunks = [Buffer.from('')];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = z.object({ id: z.string(), method: z.string() }).parse(JSON.parse(Buffer.concat(chunks).toString()));
    if (nodeState.stalled) return;
    const result = body.method === 'getblockchaininfo'
      ? { chain: 'regtest', blocks: 0, pruned: false, initialblockdownload: nodeState.ibd }
      : body.method === 'getblockhash' ? id(1000)
      : block(0, [tx(1, [output(id(100), '9007199254740993', alice)])]);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: body.id, result: nodeState.failing ? null : result,
      error: nodeState.failing ? { code: -1, message: 'secret must stay private' } : null }));
  });
  rpc.listen(0, '127.0.0.1');
  await once(rpc, 'listening');
  const rpcAddress = rpc.address();
  assert.ok(rpcAddress && typeof rpcAddress !== 'string');
  const historyRpc = createServer(async (request, response) => {
    const chunks = [Buffer.from('')];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = z.object({ id: z.string(), method: z.string() }).parse(JSON.parse(Buffer.concat(chunks).toString()));
    historyCalls.push({ method: body.method, authorization: request.headers.authorization ?? '' });
    const result = body.method === 'getblockchaininfo' ? { chain: 'regtest', blocks: 0, pruned: false, initialblockdownload: false }
      : body.method === 'getblockhash' ? id(2000) : block(0, [], 2000);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: body.id, result, error: null }));
  });
  historyRpc.listen(0, '127.0.0.1');
  await once(historyRpc, 'listening');
  const historyAddress = historyRpc.address();
  assert.ok(historyAddress && typeof historyAddress !== 'string');
  const rpcPort = rpcAddress.port;
  const historyPort = historyAddress.port;
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const apiAddress = reserve.address();
  assert.ok(apiAddress && typeof apiAddress !== 'string');
  const apiPort = apiAddress.port;
  await new Promise<void>((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  const entrypoint = process.env.BLAZE_TEST_BUILT === 'true' ? ['dist/src/main.js'] : ['--import', 'tsx', 'src/main.ts'];
  function launch() { return spawn(process.execPath, entrypoint, {
    cwd: fileURLToPath(new URL(import.meta.url.endsWith('.js') ? '../../' : '../', import.meta.url)),
    env: { ...process.env, NETWORK: 'regtest', BCH_RPC_URL: `http://127.0.0.1:${rpcPort}`,
      BCH_RPC_USER: 'test', BCH_RPC_PASSWORD: 'private-rpc-password',
      DATABASE_PATH: join(directory, 'index.sqlite'), HOST: '127.0.0.1', PORT: String(apiPort),
      TEST_RPC_PORT: undefined, RPC_PROXY_PORT: undefined,
      AUTHCHAIN_BASES: '', UNDO_DEPTH: '288', MAX_SYNC_AGE_MS: profile === 'stale' ? '100' : '30000',
      MIN_FREE_BYTES: profile === 'low-disk' ? '9007199254740991' : '0', RPC_TIMEOUT_MS: '60000',
      START_HEIGHT: '0', POLL_INTERVAL_MS: '100', SERVE_BCH_API: profile === 'token-only' ? 'false' : 'true',
      BCH_HISTORY_RPC_URL: profile === 'separate' ? `http://127.0.0.1:${historyPort}` : undefined,
      BCH_HISTORY_RPC_USER: profile === 'separate' ? 'archive' : undefined,
      BCH_HISTORY_RPC_PASSWORD: profile === 'separate' ? 'archive-password' : undefined,
      BCH_HISTORY_RPC_COOKIE_FILE: undefined,
      BCH_RPC_COOKIE_FILE: undefined, EXPECTED_GENESIS_HASH: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  }
  const child = launch();
  const messages = [''];
  child.stdout.on('data', chunk => messages.push(String(chunk)));
  child.stderr.on('data', chunk => messages.push(String(chunk)));
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
    historyRpc.closeAllConnections();
    await new Promise<void>((resolve, reject) => historyRpc.close(error => error ? reject(error) : resolve()));
    rpc.closeAllConnections();
    await new Promise<void>((resolve, reject) => rpc.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${apiPort}`;
  if (profile === 'low-disk') {
    const response = await waitFor(`${base}/readyz`, 503);
    assert.match((await response.json()).last_error, /MIN_FREE_BYTES/);
    child.kill('SIGTERM'); await exited;
    const reopened = new TokenStore({ path: join(directory, 'index.sqlite'), network: 'regtest', startHeight: 0 });
    assert.equal(reopened.tip(), null); reopened.close();
    return;
  }
  if (profile === 'ibd') {
    const response = await waitFor(`${base}/readyz`, 503);
    assert.equal((await response.json()).node_ready, false);
    nodeState.ibd = false;
  }
  const ready = await waitFor(`${base}/readyz`, 200, () => JSON.stringify({
    exit_code: child.exitCode, listening: messages.some(message => message.includes('listening')),
    startup_failed: messages.some(message => message.includes('startup failed')),
    sync_failed: messages.some(message => message.includes('sync_error')),
  }));
  assert.equal((await ready.json()).tip.height, 0);
  const balance = await fetch(`${base}/v1/tokens/${id(100)}`).then(response => response.json());
  assert.equal(balance.data.fungible_supply, '9007199254740993');
  const utxos = await fetch(`${base}/v1/tokens/${id(100)}/utxos`).then(response => response.json());
  assert.equal(utxos.data[0].fungible_token_amount, '9007199254740993');
  const authchain = authchainEnvelope.parse(await fetch(`${base}/v1/tokens/${id(100)}/authchain`).then(response => response.json()));
  assert.equal(authchain.indexed_height, 0);
  assert.equal(authchain.data.status, 'incomplete');
  assert.equal(authchain.data.coverage.status, 'incomplete');
  const bchTip = await fetch(`${base}/v1/bch/tip`);
  if (profile === 'token-only') assert.equal(bchTip.status, 404);
  else {
    assert.equal(bchTip.status, 200);
    assert.equal((await bchTip.json()).data.hash, `\\x${id(profile === 'separate' ? 2000 : 1000)}`);
  }
  if (profile === 'separate') {
    assert.equal(historyCalls.length > 0, true);
    assert.equal(historyCalls.every(call => call.authorization === `Basic ${Buffer.from('archive:archive-password').toString('base64')}`), true);
    assert.equal(historyCalls.some(call => call.method === 'getblock'), false);
  } else assert.equal(historyCalls.length, 0);
  if (profile === 'stale') {
    nodeState.stalled = true;
    await setTimeout(250);
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
    const before = Date.now();
    child.kill('SIGTERM');
    assert.equal((await exited)[0], 0);
    assert.ok(Date.now() - before < 10000, 'shutdown must cancel the 60-second stalled RPC');
    return;
  }
  if (profile === 'crash') {
    child.kill('SIGKILL'); await exited;
    clearDeadWriter(join(directory, 'index.sqlite'));
    const recovered = new TokenStore({ path: join(directory, 'index.sqlite'), network: 'regtest', startHeight: 0 });
    assert.equal(recovered.category(id(100))?.fungible_supply, '9007199254740993');
    assert.equal(recovered.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    recovered.close();
    const replacement = launch();
    const replacementExited = once(replacement, 'exit');
    t.after(async () => { if (replacement.exitCode === null && replacement.signalCode === null) replacement.kill('SIGTERM'); await replacementExited; });
    assert.equal((await waitFor(`${base}/readyz`, 200)).status, 200);
    replacement.kill('SIGTERM'); assert.equal((await replacementExited)[0], 0);
    return;
  }
  nodeState.failing = true;
  const failed = await waitFor(`${base}/readyz`, 503);
  assert.equal((await failed.json()).state, 'error');
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal(messages.join('').includes('private-rpc-password'), false);
  assert.equal(messages.join('').includes('archive-password'), false);
  assert.equal(messages.join('').includes('secret must stay private'), false);
  child.kill('SIGTERM');
  const [exitCode, signal] = await exited;
  assert.equal(exitCode, 0);
  assert.equal(signal, null);
});

}
