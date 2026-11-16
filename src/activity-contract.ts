import { z } from 'zod';
import { hash, network } from './model.js';

const integer = z.number().int().nonnegative();
const quantity = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const activityEnvelope = z.object({ network, confirmed_only: z.literal(true), indexed_height: integer.nullable(),
  snapshot: z.object({ height: integer, hash, previousHash: hash.nullable() }).nullable(),
  coverage: z.object({ start_height: integer, token_state: z.object({
    status: z.enum(['not_indexed', 'complete_at_indexed_tip', 'incomplete']), reason: z.string().nullable(),
  }), gross_fungible_details_start: integer }),
  order: z.literal('block_height_desc,transaction_position_desc,txid_asc'), metadata_only_authchain_events: z.literal('excluded'),
  data: z.array(z.object({ txid: hash, transaction_position: integer,
    block: z.object({ height: integer, hash, timestamp: integer }), categories: z.array(z.object({ category: hash,
      fungible_delta: z.string().regex(/^-?(0|[1-9][0-9]*)$/), nft_delta: z.number().int(),
      fungible_issued: quantity.nullable(), fungible_burned: quantity.nullable(),
      category_history_complete: z.boolean(), gross_fungible_details_complete: z.boolean(),
    })).min(1) })).max(100),
});
