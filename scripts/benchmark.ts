import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { createApi } from '../src/api.js';
import { IndexerError } from '../src/model.js';
import { TokenStore } from '../src/store.js';

const settings = z.object({
  BENCH_OUTPUTS: z.coerce.number().int().min(100).max(500000).default(20000),
  BENCH_REQUESTS: z.coerce.number().int().min(10).max(1000).default(100),
}).parse(process.env);
const category = 'a'.repeat(64);
const store = new TokenStore({ path: ':memory:', network: 'regtest', startHeight: 0 });
const api = await createApi({ store, corsOrigins: [] });

async function measure(url: string) {
  for (const _ of Array.from({ length: 10 })) await api.inject(url);
  const durations = Array.from({ length: settings.BENCH_REQUESTS }, () => 0);
  for (const index of durations.keys()) {
    const start = performance.now();
    const response = await api.inject(url);
    if (response.statusCode !== 200) throw new IndexerError({ message: 'Benchmark request failed' });
    durations[index] = performance.now() - start;
  }
  durations.sort((a, b) => a - b);
  return { requests: durations.length, p50_ms: durations[Math.floor(durations.length * 0.5)],
    p95_ms: durations[Math.floor(durations.length * 0.95)] };
}

try {
  const block = {
    hash: '0'.repeat(64), height: 0, time: 1700000000,
    tx: [{ txid: '1'.repeat(64), vin: [{ coinbase: '00' }],
      vout: Array.from({ length: settings.BENCH_OUTPUTS }, (_, n) => ({
        n, value: 0.000008, scriptPubKey: { hex: `76a914${(n % 1000).toString(16).padStart(40, '0')}88ac` },
        tokenData: { category, amount: '9007199254' },
      })),
    }],
  };
  const start = performance.now();
  store.applyBlock(block);
  const ingestionMs = performance.now() - start;
  console.log(JSON.stringify({
    workload: 'synthetic in-memory SQLite + Fastify injection; no network or BCHN timing',
    node: process.version, outputs: settings.BENCH_OUTPUTS, holder_count: 1000, ingestion_ms: ingestionMs,
    category: await measure(`/v1/tokens/${category}`),
    holders_page: await measure(`/v1/tokens/${category}/holders?limit=25`),
    utxos_page: await measure(`/v1/tokens/${category}/utxos?limit=25`),
    rss_bytes: process.memoryUsage().rss,
  }, null, 2));
} finally { await api.close(); store.close(); }
