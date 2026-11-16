import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { ownedScenario } from './helpers/owned-scenario.js';
import { freePort } from './helpers/owned-node.js';
import { IndexerError } from '../src/model.js';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());

async function main() {
  const binary = z.string().min(1).parse(process.env.BCHN_TEST_BINARY);
  const node = await ownedScenario(binary);
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/src/main.js'], { stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, NETWORK: 'regtest', BCH_RPC_URL: `http://127.0.0.1:${node.port}`,
      BCH_RPC_COOKIE_FILE: node.cookiePath, BCH_RPC_USER: undefined, BCH_RPC_PASSWORD: undefined,
      BCH_HISTORY_RPC_URL: undefined, BCH_HISTORY_RPC_COOKIE_FILE: undefined, BCH_HISTORY_RPC_USER: undefined,
      BCH_HISTORY_RPC_PASSWORD: undefined, EXPECTED_GENESIS_HASH: undefined,
      AUTHCHAIN_BASES: node.category, SERVE_BCH_API: 'true', START_HEIGHT: '0',
      PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: join(node.directory, 'consumer-index.sqlite'),
      POLL_INTERVAL_MS: '500', MAX_SYNC_AGE_MS: '5000', MIN_FREE_BYTES: '0' } });
  child.stderr.on('data', () => { /* Child diagnostics remain local and never forward credentials. */ });
  const stopped = once(child, 'exit');
  const artifact = '.build/reports/regtest-connection.json';
  const leaseMs = 1800000;
  try {
    const deadline = Date.now() + 30000;
    const measured = z.object({ status: z.object({ network: z.literal('regtest'), tip: z.object({ height: z.literal(103), hash: z.string() }), schema_version: z.literal(4) }).passthrough().nullable() }).parse({ status: null });
    while (Date.now() < deadline && !controller.signal.aborted) {
      try {
        const response = await fetch(`${endpoint}/readyz`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200) { measured.status = z.object({ network: z.literal('regtest'),
          tip: z.object({ height: z.literal(103), hash: z.string() }), schema_version: z.literal(4) }).passthrough().parse(await response.json()); break; }
      } catch { if (child.exitCode !== null) break; }
      await setTimeout(100);
    }
    if (measured.status === null) throw new IndexerError({ message: 'Owned process-backed regtest REST did not become ready' });
    const tx = await fetch(`${endpoint}/v1/bch/transactions/${node.genesisTxid}`).then(response => response.json());
    z.object({ data: z.object({ input_value_satoshis: z.string(), inputs: z.array(z.object({ outpoint: z.object({ locking_bytecode: z.string() }) })) }) }).parse(tx);
    const connection = { status: 'verified', network: 'regtest', is_chipnet: false, purpose: 'supporting consumer process acceptance only',
      owner: 'Blaze Indexer execution thread', owner_pid: process.pid, indexer_pid: child.pid, node_pid: node.pid,
      rest_url: endpoint, ready: measured.status, indexed_start: 0,
      authchain_coverage: 'complete from fresh regtest genesis; discovery only',
      category: node.category, nft: { txid: node.genesisTxid, vout: 0, capability: 'mutable', commitment: '' },
      txid: node.genesisTxid, address: node.holder, locking_bytecode: node.script,
      prevout: { txid: node.category, vout: 0, resolvable: true },
      rpc_access: 'owner-only local node cookie, never provided to consumers; REST read routes only',
      expires_at: new Date(Date.now() + leaseMs).toISOString(), cleanup: 'owner SIGTERM or 30-minute automatic lease; do not kill other services' };
    mkdirSync('.build/reports', { recursive: true });
    writeFileSync(artifact, JSON.stringify(connection, null, 2));
    console.log(JSON.stringify(connection));
    try { await setTimeout(leaseMs, undefined, { signal: controller.signal }); } catch { /* Owned lease cancelled. */ }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await stopped;
    await node.close();
    mkdirSync('.build/reports', { recursive: true });
    const previous = existsSync(artifact) ? z.record(z.string(), z.json()).parse(JSON.parse(readFileSync(artifact, 'utf8'))) : {};
    writeFileSync(artifact, JSON.stringify({ ...previous, status: 'stopped', network: 'regtest', stopped_at: new Date().toISOString() }));
  }
}
main().catch(() => { console.error('Owned regtest target failed; see local acceptance tests. No Chipnet endpoint was provisioned.'); process.exitCode = 1; });
