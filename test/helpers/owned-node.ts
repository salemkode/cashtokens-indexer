import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { IndexerError } from '../../src/model.js';

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new IndexerError({ message: 'No isolated test port' });
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function ownedNode(binary: string) {
  const directory = await mkdtemp(join(tmpdir(), 'blaze-regtest-'));
  const port = await freePort();
  const child = spawn(binary, ['-regtest', `-datadir=${directory}`, '-server=1', '-listen=0', '-discover=0',
    '-dnsseed=0', '-connect=0', '-upnp=0', '-natpmp=0', '-rpcbind=127.0.0.1', `-rpcport=${port}`,
    '-txindex=1', '-fallbackfee=0.00001', '-persistmempool=0', '-dbcache=64', '-par=1', '-printtoconsole=0'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  const errors = new Array<string>();
  child.stderr.on('data', chunk => { if (errors.join('').length < 4000) errors.push(String(chunk)); });
  const stopped = once(child, 'exit');
  // Cookie auth binds the port to this exact newly-spawned owned node, never an operator URL.
  const endpoint = `http://127.0.0.1:${port}`;
  const cookiePath = join(directory, 'regtest', '.cookie');
  async function call(method: string, params: unknown[] = [], wallet?: string) {
    const cookie = (await readFile(cookiePath, 'utf8')).trim();
    const response = await fetch(wallet === undefined ? endpoint : `${endpoint}/wallet/${encodeURIComponent(wallet)}`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Basic ${Buffer.from(cookie).toString('base64')}`,
    }, body: JSON.stringify({ id: 'owned-regtest', method, params }), signal: AbortSignal.timeout(10000) });
    const body = z.object({ result: z.unknown(), error: z.object({ code: z.number(), message: z.string() }).nullable() })
      .parse(await response.json());
    if (body.error !== null) throw new IndexerError({ message: `Owned regtest ${method}: ${body.error.code} ${body.error.message}` });
    return body.result;
  }
  async function close() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await stopped;
    await rm(directory, { recursive: true, force: true });
  }
  try {
    const deadline = Date.now() + 30000;
    const ready = { value: false, error: '' };
    while (Date.now() < deadline) {
      try {
        const info = z.object({ chain: z.literal('regtest') }).parse(await call('getblockchaininfo'));
        const network = z.object({ connections: z.literal(0) }).parse(await call('getnetworkinfo'));
        ready.value = info.chain === 'regtest' && network.connections === 0;
        break;
      } catch (cause) {
        ready.error = cause instanceof IndexerError ? cause.message : cause instanceof z.ZodError
          ? cause.issues.map(issue => issue.path.join('.')).join(',') : 'cookie/connection not ready';
        if (child.exitCode !== null) break; await setTimeout(100);
      }
    }
    if (!ready.value) throw new IndexerError({ message: `Owned BCHN regtest did not start with networking disabled: ${ready.error} ${errors.join('').slice(0, 1800)}` });
    return { directory, port, cookiePath, call, close, pid: child.pid };
  } catch (cause) { await close(); throw cause; }
}
