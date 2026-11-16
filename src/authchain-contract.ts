import { z } from 'zod';
import { amount, hash, hex, network } from './model.js';

// Public integration boundary: verifier/explorer consumers need one versioned machine-readable contract.
const height = z.number().int().nonnegative();
const publicationNone = z.object({ status: z.literal('none') });
const publicationInvalid = z.object({ status: z.literal('invalid'), locking_bytecode: hex });
const publicationPublished = z.object({ status: z.literal('published'), locking_bytecode: hex,
  content_hash: hash, uris: z.array(z.string()), content_verified: z.literal(false) });
const publication = z.discriminatedUnion('status', [publicationNone, publicationInvalid, publicationPublished]);
const coverage = z.object({
  status: z.enum(['complete', 'incomplete']), method: z.literal('targeted_native_scan').optional(), scan_start: height, indexed_height: height.nullable(),
  indexed_tip: z.object({ height, hash, previousHash: hash.nullable() }).nullable(),
  reason: z.string().nullable(), root_publication_available: z.boolean(),
});
const observed = z.object({
  category: hash, status: z.enum(['tracked', 'burned', 'incomplete']),
  head_state: z.enum(['burned', 'unspent_at_indexed_tip']), discovery_only: z.literal(true), coverage,
  authbase: hash,
  authhead: z.object({ txid: hash, output_index: z.literal(0), height, timestamp: height,
    locking_bytecode: hex, value_satoshis: z.string().regex(/^(0|[1-9][0-9]*)$/),
    token_category: hash.nullable(), fungible_token_amount: amount.nullable(),
    nonfungible_token_capability: z.enum(['none', 'mutable', 'minting']).nullable(),
    nonfungible_token_commitment: hex.nullable() }),
  authchain_length: z.number().int().nonnegative(),
  latest_publication: z.union([
    publicationInvalid.extend({ txid: hash }), publicationPublished.extend({ txid: hash }),
  ]).nullable(),
  publication_history_complete: z.boolean(),
  revisions: z.array(z.object({ txid: hash, previous_txid: hash.nullable(), height, timestamp: height,
    migration_index: z.number().int().nonnegative(), publication })).max(500),
  metadata_content_verified: z.literal(false),
});
const missing = z.object({ category: hash, status: z.literal('incomplete'),
  coverage: coverage.extend({ status: z.literal('incomplete') }), reason: z.string() });

export const authchainEnvelope = z.object({ network, confirmed_only: z.literal(true),
  indexed_height: height.nullable(), data: z.union([observed, missing]) });
