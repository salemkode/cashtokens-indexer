import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { IndexerError } from './model.js';

const rpcConfig = z.object({
  url: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'RPC requires HTTP or HTTPS'),
  username: z.string().optional(),
  password: z.string().optional(),
  cookieFile: z.string().optional(),
  maxResponseBytes: z.number().int().min(1).max(268435456).default(67108864),
  timeoutMs: z.number().int().min(1).max(300000).default(30000),
});
export const readRpcMethods = z.enum([
  'getblockchaininfo', 'getblockhash', 'getblock', 'getblockheader', 'getblockstats',
  'gettxout', 'getrawtransaction', 'getrawmempool', 'getmempoolinfo', 'getnetworkinfo', 'getindexinfo',
]);

const testRpcMethod = z.enum([...readRpcMethods.options, 'decoderawtransaction', 'testmempoolaccept', 'sendrawtransaction']);

export class RpcResponseError extends IndexerError {
  readonly code;
  constructor(method: string, code: number) {
    super({ message: `BCH RPC ${method} failed (code ${code})` });
    this.code = code;
  }
}
const rpcEnvelope = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).nullable(),
});

/** Read-only BCHN RPC client. Credentials never appear in error messages. */
class RpcTransport {
  #methods;
  #config;
  #signal;
  #slots = { active: 0 };
  #waiting = new Array<() => void>();

  constructor(input: z.input<typeof rpcConfig>, methods: typeof readRpcMethods | typeof testRpcMethod, signal?: AbortSignal) {
    this.#signal = signal;
    this.#methods = methods;
    this.#config = rpcConfig.parse(input);
  }

  async call(method: string, params: unknown[] = []) {
    const name = this.#methods.parse(method);
    if (this.#slots.active < 8) this.#slots.active += 1;
    else {
      if (this.#waiting.length >= 64) throw new IndexerError({ message: 'BCH RPC global request queue is full' });
      await new Promise<void>(resolve => this.#waiting.push(resolve));
    }
    try { return await this.#request(name, params); }
    finally {
      const next = this.#waiting.shift();
      if (next === undefined) this.#slots.active -= 1;
      else next();
    }
  }

  async #request(name: string, params: unknown[]) {
    const endpoint = new URL(this.#config.url);
    const urlCredentials = endpoint.username || endpoint.password
      ? `${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`
      : undefined;
    const configuredCredentials = this.#config.username !== undefined || this.#config.password !== undefined
      ? `${this.#config.username ?? ''}:${this.#config.password ?? ''}`
      : urlCredentials;
    endpoint.username = '';
    endpoint.password = '';
    const id = randomUUID();

    try {
      // Read each time: BCHN rotates its cookie when it restarts.
      const credentials = this.#config.cookieFile
        ? (await readFile(this.#config.cookieFile, 'utf8')).trim()
        : configuredCredentials;
      const headers = {
        'content-type': 'application/json',
        ...(credentials === undefined ? {} : { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` }),
      };
      const response = await fetch(endpoint, {
        method: 'POST', headers, redirect: 'error',
        body: JSON.stringify({ jsonrpc: '1.0', id, method: name, params }),
        signal: this.#signal === undefined ? AbortSignal.timeout(this.#config.timeoutMs)
          : AbortSignal.any([this.#signal, AbortSignal.timeout(this.#config.timeoutMs)]),
      });
      const reader = response.body?.getReader();
      if (reader === undefined) throw new IndexerError({ message: `BCH RPC ${name} returned an empty response` });
      const chunks = new Array<Uint8Array>();
      const size = { bytes: 0 };
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size.bytes += chunk.value.length;
          if (size.bytes > this.#config.maxResponseBytes) {
            await reader.cancel();
            throw new IndexerError({ message: `BCH RPC ${name} response exceeds configured byte limit` });
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const envelope = rpcEnvelope.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!envelope.success || envelope.data.id !== id) {
        throw new IndexerError({ message: `BCH RPC ${name} returned an invalid response` });
      }
      if (envelope.data.error !== null) {
        throw new RpcResponseError(name, envelope.data.error.code);
      }
      if (!response.ok || !Object.hasOwn(envelope.data, 'result')) {
        throw new IndexerError({ message: `BCH RPC ${name} failed (HTTP ${response.status})` });
      }
      return envelope.data.result;
    } catch (cause) {
      if (cause instanceof IndexerError) throw cause;
      // Fetch and filesystem errors may embed URLs or cookie paths; do not propagate them.
      throw new IndexerError({ message: `BCH RPC ${name} request failed` });
    }
  }
}


export class BitcoinRpc extends RpcTransport {
  constructor(input: z.input<typeof rpcConfig>, signal?: AbortSignal) { super(input, readRpcMethods, signal); }
}

/** Separate capability transport: never wallet/signing/admin methods; mainnet is forbidden. */
export class ScopedTestRpc extends RpcTransport {
  readonly network;
  constructor(input: z.input<typeof rpcConfig>, selected: 'chipnet' | 'regtest', signal?: AbortSignal) {
    const checked = z.enum(['chipnet', 'regtest']).parse(selected);
    super(input, testRpcMethod, signal);
    this.network = checked;
  }
}
