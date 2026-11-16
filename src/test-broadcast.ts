import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { z } from 'zod';
import { hash, hex, IndexerError } from './model.js';
import { chipnetCheckpoint, chipnetGenesis } from './network.js';
import { RpcResponseError, ScopedTestRpc } from './rpc.js';

const signedHex = hex.pipe(z.string().min(20).max(2000000));
const approval = z.object({ network: z.enum(['chipnet', 'regtest']), genesis_hash: hash,
  dedicated_test_identity: z.literal(true),
  max_fee_satoshis: z.string().regex(/^(0|[1-9][0-9]*)$/).refine(value => BigInt(value) <= 1000000n), capability: z.string().regex(/^[0-9a-f]{64}$/),
  allowed_outpoints: z.array(z.object({ txid: hash, vout: z.number().int().nonnegative() })).max(100),
  transactions: z.array(z.object({ txid: hash, hex: signedHex, expires_at: z.iso.datetime() })).max(100),
});
function transactionId(bytes: string) {
  return createHash('sha256').update(createHash('sha256').update(Buffer.from(bytes, 'hex')).digest()).digest().reverse().toString('hex');
}

/** Exact signed-byte approvals and durable no-resubmit journal; no keys, custody or broad broadcast proxy. */
export function createTestBroadcast(rpc: Pick<ScopedTestRpc, 'call' | 'network'>, policyPath: string, journalPath: string) {
  const app = Fastify({ bodyLimit: 2200000, requestTimeout: 30000, forceCloseConnections: true });
  const db = new DatabaseSync(journalPath);
  chmodSync(journalPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS submissions(txid TEXT PRIMARY KEY, hex TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(submissions)').all().some(row => row.name === 'fee_satoshis')) db.exec('ALTER TABLE submissions ADD COLUMN fee_satoshis TEXT');
  app.addHook('onClose', () => { db.close(); });
  const capacity = { active: 0 };
  const slots = new WeakSet<object>();
  app.addHook('onRequest', async (request, reply) => {
    if (capacity.active >= 4) return reply.code(429).send({ error: 'Approved test submission capacity is busy.' });
    slots.add(request); capacity.active += 1;
  });
  app.addHook('onResponse', async request => {
    if (slots.delete(request)) capacity.active -= 1;
  });
  const active = new Set<string>();
  app.post('/', async (request, reply) => {
    if (request.headers.origin !== undefined) return reply.code(403).send({ error: 'Server-to-server approved test submissions only.' });
    const raw = z.object({ id: z.union([z.string().max(200), z.number(), z.null()]),
      method: z.enum(['testmempoolaccept', 'sendrawtransaction']), params: z.array(z.json()).max(2) }).safeParse(request.body);
    if (!raw.success) return reply.code(400).send({ error: 'Invalid test submission request.' });
    const { id, method, params } = raw.data;
    function error(code: number, message: string) { return { jsonrpc: '2.0', id, result: null, error: { code, message } }; }
    try {
      const file = statSync(policyPath);
      if (file.size > 4194304 || (file.mode & 0o077) !== 0 || (process.getuid !== undefined && file.uid !== process.getuid())) {
        throw new IndexerError({ message: 'Test policy must be private and owned by the service user' });
      }
      const policy = approval.parse(JSON.parse(readFileSync(policyPath, 'utf8')));
      const presented = request.headers.authorization?.replace(/^Bearer /, '');
      if (presented === undefined || !/^[0-9a-f]{64}$/.test(presented) || !timingSafeEqual(Buffer.from(presented), Buffer.from(policy.capability))) {
        return reply.code(403).send(error(-32001, 'Invalid test capability'));
      }
      if (policy.network !== rpc.network) return error(-32002, 'Test policy network differs');
      const source = z.object({ chain: z.string(), blocks: z.number().int().nonnegative(), initialblockdownload: z.literal(false) })
        .parse(await rpc.call('getblockchaininfo'));
      const genesis = hash.parse(await rpc.call('getblockhash', [0]));
      if (source.chain !== (rpc.network === 'chipnet' ? 'chip' : 'regtest') || genesis !== policy.genesis_hash) {
        return error(-32002, 'Test source identity differs');
      }
      if (rpc.network === 'chipnet' && (genesis !== chipnetGenesis || source.blocks < chipnetCheckpoint.height
        || hash.parse(await rpc.call('getblockhash', [chipnetCheckpoint.height])) !== chipnetCheckpoint.hash)) {
        return error(-32002, 'Chipnet checkpoint differs');
      }
      // Exactly one signed transaction; no automatic retries and no allowhighfees override.
      const bytes = method === 'sendrawtransaction' ? z.tuple([signedHex]).parse(params)[0]
        : z.tuple([z.tuple([signedHex])]).parse(params)[0][0];
      const txid = transactionId(bytes);
      const grant = policy.transactions.find(tx => tx.txid === txid && tx.hex === bytes);
      if (grant === undefined || Date.parse(grant.expires_at) <= Date.now() || Date.parse(grant.expires_at) > Date.now() + 3600000) {
        return error(-32003, 'Exact signed bytes need an unexpired approval of at most one hour');
      }
      const decoded = z.object({ txid: hash, vin: z.array(z.object({ txid: hash, vout: z.number().int().nonnegative() })).min(1).max(100),
        vout: z.array(z.object({ value: z.number().finite().nonnegative().max(21000000) })).min(1) })
        .parse(await rpc.call('decoderawtransaction', [bytes]));
      if (decoded.txid !== txid || decoded.vin.some(input => !policy.allowed_outpoints.some(point => point.txid === input.txid && point.vout === input.vout))) {
        return error(-32003, 'Transaction inputs are not dedicated approved test outpoints');
      }
      if (active.has(txid)) return error(-32020, 'Submission in progress; reconcile txid, do not resubmit');
      const previous = db.prepare('SELECT state FROM submissions WHERE txid=?').get(txid);
      if (previous !== undefined && method === 'sendrawtransaction') {
        try {
          const observed = z.object({ txid: hash }).parse(await rpc.call('getrawtransaction', [txid, true]));
          if (observed.txid === txid) {
            db.prepare("UPDATE submissions SET state='accepted' WHERE txid=?").run(txid);
            return { jsonrpc: '2.0', id, result: txid, error: null };
          }
        } catch { /* Unknown visibility is never permission to rebroadcast. */ }
        return error(-32020, 'Previous submission is unresolved or rejected; journal retained, no rebroadcast');
      }
      const inputs = new Array<bigint>();
      for (const batch of Array.from({ length: Math.ceil(decoded.vin.length / 8) }, (_, index) => decoded.vin.slice(index * 8, index * 8 + 8))) {
        const values = await Promise.all(batch.map(async input => {
          const coin = z.object({ value: z.number().finite().nonnegative().max(21000000) }).parse(
            await rpc.call('gettxout', [input.txid, input.vout, true]));
          return BigInt(coin.value.toFixed(8).replace('.', ''));
        }));
        inputs.push(...values);
      }
      const fee = inputs.reduce((sum, value) => sum + value, 0n) - decoded.vout.reduce(
        (sum, output) => sum + BigInt(output.value.toFixed(8).replace('.', '')), 0n);
      if (fee < 0n || fee > BigInt(policy.max_fee_satoshis)) return error(-32003, 'Exact transaction fee exceeds approved test policy');
      if (method === 'testmempoolaccept') return { jsonrpc: '2.0', id, result: await rpc.call(method, [[bytes]]), error: null };
      if (active.has(txid) || db.prepare('SELECT 1 FROM submissions WHERE txid=?').get(txid) !== undefined)
        return error(-32020, 'Submission state changed during inspection; reconcile txid, do not resubmit');
      active.add(txid);
      try {
        const accepted = z.array(z.object({ allowed: z.boolean() })).parse(await rpc.call('testmempoolaccept', [[bytes]]));
        if (accepted[0]?.allowed !== true) return error(-26, 'Node preflight rejected signed test transaction');
        db.prepare("INSERT INTO submissions(txid,hex,state,created_at,fee_satoshis) VALUES (?, ?, 'pending', ?, ?)").run(txid, bytes, new Date().toISOString(), fee.toString());
        try {
          const result = hash.parse(await rpc.call('sendrawtransaction', [bytes]));
          if (result !== txid) throw new IndexerError({ message: 'Upstream submission hash differs' });
          db.prepare("UPDATE submissions SET state='accepted' WHERE txid=?").run(txid);
          return { jsonrpc: '2.0', id, result: txid, error: null };
        } catch (cause) {
          db.prepare('UPDATE submissions SET state=? WHERE txid=?').run(cause instanceof RpcResponseError ? 'rejected' : 'unknown', txid);
          return error(-32020, 'Broadcast response uncertain/rejected; reconcile exact txid; no automatic retry');
        }
      } finally { active.delete(txid); }
    } catch { return error(-32000, 'Approved test submission is unavailable; check private policy and verified upstream'); }
  });
  return app;
}
