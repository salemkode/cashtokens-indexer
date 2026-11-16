import { Data } from 'effect';
import { z } from 'zod';

export class IndexerError extends Data.TaggedError('IndexerError')<{
  message: string;
  cause?: unknown;
}> {}

export const hash = z.string().regex(/^[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase());
export const hex = z.string().regex(/^(?:[0-9a-fA-F]{2})*$/).transform(value => value.toLowerCase());
export const amount = z.string().regex(/^(0|[1-9][0-9]*)$/)
  .refine(value => BigInt(value) <= 9223372036854775807n, 'CashTokens amount exceeds 2^63 - 1');
export const token = z.object({
  category: hash,
  amount,
  nft: z.object({
    capability: z.enum(['none', 'mutable', 'minting']),
    commitment: hex.refine(value => value.length <= 256, 'NFT commitment exceeds 128 bytes'),
  }).optional(),
}).refine(value => value.nft !== undefined || BigInt(value.amount) > 0n, 'Empty token prefix');
export const rpcTransaction = z.object({
  txid: hash,
  vin: z.array(z.union([
    z.object({ txid: hash, vout: z.number().int().nonnegative() }),
    z.object({ coinbase: hex }),
  ])),
  vout: z.array(z.object({
    n: z.number().int().nonnegative(),
    value: z.number().finite().nonnegative().max(21000000),
    scriptPubKey: z.object({ hex, address: z.string().optional(), addresses: z.array(z.string()).optional() }),
    tokenData: token.optional(),
  })),
});
export const rpcBlock = z.object({
  hash,
  height: z.number().int().nonnegative(),
  previousblockhash: hash.optional(),
  time: z.number().int().nonnegative(),
  tx: z.array(rpcTransaction),
});
export const outputFilter = z.object({
  category: hash.optional(),
  scripts: z.array(hex).max(100).optional(),
  nft: z.boolean().optional(),
  capability: z.enum(['none', 'mutable', 'minting']).optional(),
  excludeMinting: z.boolean().optional(),
  limit: z.number().int().min(1).max(5000).default(100),
  offset: z.number().int().min(0).max(10000000).default(0),
});
export const page = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(10000000).default(0),
});
export const network = z.enum(['mainnet', 'chipnet', 'regtest']);
