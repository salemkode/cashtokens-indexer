import { parseArgs } from 'node:util';
import { open, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { BitcoinRpc } from '../src/rpc.js';
import { configSchema } from '../src/config.js';
import { verifyServer, serverCheckOptions } from '../src/server-verification.js';
import { IndexerError } from '../src/model.js';

async function main() {
  const { values } = parseArgs({ options: { category: { type: 'string' }, 'report-file': { type: 'string' } } });
  const args = z.object({ category: serverCheckOptions.shape.category, 'report-file': z.string().min(1) }).parse(values);
  const config = configSchema.parse(process.env);
  if (!config.SERVE_BCH_API) throw new IndexerError({ message: 'Full server acceptance requires BCH history routes' });
  const options = serverCheckOptions.parse({ network: config.NETWORK, category: args.category });
  const deadline = AbortSignal.timeout(120000);
  const rpc = new BitcoinRpc({ url: config.BCH_RPC_URL, username: config.BCH_RPC_USER, password: config.BCH_RPC_PASSWORD,
    cookieFile: config.BCH_RPC_COOKIE_FILE, timeoutMs: 10000, maxResponseBytes: 2097152 }, deadline);
  const history = config.BCH_HISTORY_RPC_URL === undefined ? rpc : new BitcoinRpc({ url: config.BCH_HISTORY_RPC_URL,
    username: config.BCH_HISTORY_RPC_USER, password: config.BCH_HISTORY_RPC_PASSWORD,
    cookieFile: config.BCH_HISTORY_RPC_COOKIE_FILE, timeoutMs: 10000, maxResponseBytes: 2097152 }, deadline);
  const origin = `http://127.0.0.1:${config.PORT}`;
  async function get(path: string) {
    const response = await fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new IndexerError({ message: 'Server read check did not return HTTP 200' }); }
    const reader = response.body?.getReader();
    if (reader === undefined) throw new IndexerError({ message: 'Missing server response' });
    const chunks = new Array<Uint8Array>();
    const size = { bytes: 0 };
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size.bytes += result.value.byteLength;
        if (size.bytes > 2097152) throw new IndexerError({ message: 'Server response exceeds acceptance budget' });
        chunks.push(result.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const report = await verifyServer(options, rpc, history, get);
  await mkdir(dirname(args['report-file']), { recursive: true, mode: 0o700 });
  const file = await open(args['report-file'], 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(report, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  console.log(JSON.stringify({ status: report.status, network: report.network, checked_utxos: report.checked_utxos,
    height: report.tip.height, report: args['report-file'] }));
}

main().catch(() => {
  console.error('Server acceptance failed. Check private configuration, network/checkpoints, readiness, archive/txindex, a small live category, and an unused report path. No writes to the chain were attempted.');
  process.exitCode = 1;
});
