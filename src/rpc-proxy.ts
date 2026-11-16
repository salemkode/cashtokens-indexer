import Fastify from 'fastify';
import { z } from 'zod';
import { hash, IndexerError, network } from './model.js';
import { chipnetCheckpoint, chipnetGenesis } from './network.js';
import { BitcoinRpc, readRpcMethods, RpcResponseError } from './rpc.js';

/** Loopback server-to-server read access. No upstream URL/credentials or wallet/write RPCs are exposed. */
export function createReadProxy(rpc: Pick<BitcoinRpc, 'call'>, selected: z.infer<typeof network>) {
  const app = Fastify({ bodyLimit: 128000, requestTimeout: 30000, connectionTimeout: 15000, forceCloseConnections: true });
  const capacity = { active: 0 };
  app.post('/', async (request, reply) => {
    if (request.headers.origin !== undefined) return reply.code(403).send({ error: 'Server-to-server RPC only.' });
    const raw = z.object({ id: z.union([z.string().max(200), z.number(), z.null()]),
      method: z.string(), params: z.array(z.json()).max(20).default([]) }).safeParse(request.body);
    if (!raw.success) return reply.code(400).send({ jsonrpc: '2.0', id: null, result: null, error: { code: -32600, message: 'Invalid request' } });
    const { id, params } = raw.data;
    const method = readRpcMethods.safeParse(raw.data.method);
    if (!method.success) return { jsonrpc: '2.0', id, result: null, error: { code: -32601, message: 'Read method is not allowed' } };
    if (capacity.active >= 8) return reply.code(429).send({ jsonrpc: '2.0', id, result: null, error: { code: -32005, message: 'Read capacity exceeded' } });
    capacity.active += 1;
    try {
      const source = z.object({ chain: z.string(), blocks: z.number().int().nonnegative() }).parse(await rpc.call('getblockchaininfo'));
      const expected = { mainnet: 'main', chipnet: 'chip', regtest: 'regtest' }[selected];
      if (source.chain !== expected) throw new IndexerError({ message: 'RPC network mismatch' });
      if (selected === 'mainnet' && (source.blocks < 792773 || hash.parse(await rpc.call('getblockhash', [792773])) !==
        '000000000000000002fc0cdadaef1857bbd2936d37ea94f80ba3db4a5e8353e8')) throw new IndexerError({ message: 'BCH mainnet checkpoint mismatch' });
      if (selected === 'chipnet' && (source.blocks < chipnetCheckpoint.height
        || hash.parse(await rpc.call('getblockhash', [0])) !== chipnetGenesis
        || hash.parse(await rpc.call('getblockhash', [chipnetCheckpoint.height])) !== chipnetCheckpoint.hash)) {
        throw new IndexerError({ message: 'RPC Chipnet checkpoint mismatch' });
      }
      return { jsonrpc: '2.0', id, result: await rpc.call(method.data, params), error: null };
    } catch (cause) {
      return { jsonrpc: '2.0', id, result: null, error: { code: cause instanceof RpcResponseError ? cause.code : -32000,
        message: 'Verified upstream read is unavailable' } };
    } finally { capacity.active -= 1; }
  });
  return app;
}
