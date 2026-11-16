# Global CashTokens activity — v1

Implemented route: `GET /v1/activity?limit=9&offset=0`.
Machine-readable contract: [activity-api-v1.schema.json](activity-api-v1.schema.json).
The API validates responses against `src/activity-contract.ts`.

This is **transaction activity**, not a category/genesis listing. It reads retained
compact transactions and category movements; it does not scan node blocks or build
an address/transaction graph. Transactions with no token outputs but known token
inputs are included, including complete burns. Pure BCH metadata-only authchain
updates are **excluded**; a metadata update which also spends/destroys tokens is
included because it changes token state.

```json
{
  "network": "chipnet",
  "confirmed_only": true,
  "indexed_height": 332433,
  "snapshot": { "height": 332433, "hash": "<plain hex>", "previousHash": "<plain hex or null>" },
  "coverage": {
    "start_height": 121957,
    "token_state": { "status": "complete_at_indexed_tip", "reason": null },
    "gross_fungible_details_start": 121957
  },
  "order": "block_height_desc,transaction_position_desc,txid_asc",
  "metadata_only_authchain_events": "excluded",
  "data": [{
    "txid": "<plain 64 lowercase hex>",
    "transaction_position": 5,
    "block": { "height": 332433, "hash": "<plain hex>", "timestamp": 1794730000 },
    "categories": [{
      "category": "<plain hex>",
      "fungible_delta": "-9007199254740993",
      "nft_delta": -1,
      "fungible_issued": "0",
      "fungible_burned": "9007199254740993",
      "category_history_complete": true,
      "gross_fungible_details_complete": true
    }]
  }]
}
```

The values in the example illustrate the schema, **not a measured Chipnet row**.
Actual Chipnet data remains unavailable until the owner connection record verifies
an upstream and running REST service. Do not treat fixture heights as a live tip.

## Pagination and fork identity

- `limit`: integer 1–100, default **9**. `offset`: 0–10,000,000, default 0.
- Transactions: height descending, original node transaction position descending,
  txid ascending as deterministic tie-breaker. A CTOR block's position is the node's
  order, not a claim that its spend graph is topological. Categories sort by ID.
- Optional `snapshot_hash=<hash>` requires the current committed index tip to match;
  otherwise **409** tells the consumer to restart pagination. Carry the first
  response's `snapshot.hash` into later pages. Invalid parameters return **400**.
- This is the canonical **indexed snapshot**. Check `/readyz` and timestamps before
  treating it as caught up. The index can lag a new block/reorg; offset pages are
  not persisted historical cursors. Orphaned movements disappear atomically on
  rollback and old snapshot hashes no longer match.

## Exact amounts, issuance and burns

- All fungible fields are raw decimal integer **strings**, including negative live
  supply deltas and values above 2^53. Metadata decimals are not applied.
- `fungible_delta` = observed spendable token outputs minus observed token inputs.
  `nft_delta` is the corresponding **net spendable NFT count change**, including
  minting/mutable/immutable capabilities. It is not NFT provenance or a gross
  mint/burn identity pairing when both happen in one transaction.
- For categories with an observed valid genesis, `fungible_issued` is positive
  excess of all token outputs over token inputs; `fungible_burned` is input/output
  destruction plus fungibles in unspendable outputs. Thus a genesis with 100 created
  units, 10 immediately unspendable, reports issued100/burned10/delta90. A complete
  input-only burn of 9007199254740993 reports exactly that burned amount.
- Issuance uses the protocol's first input/outpoint0 genesis rule. Authority to mint
  NFTs is never presented as issuer identity.
- If a category's genesis was not observed, the scan may lack historical inputs:
  `category_history_complete=false`, gross fields are **null**, and live deltas are
  explicitly observed effects within the partial index. They are not invented
  issuance amounts. Global partial coverage stays visible in `coverage.token_state`.
- Before any block is committed, token coverage is `not_indexed`, tip/height are
  null and rows are empty. After a late scan, global coverage is `incomplete`.
  Starting at Chipnet activation121957 can cover token state at the indexed tip,
  while authbase metadata coverage may still be incomplete.

## Migration and retention

Activity feature schema version1 adds two nullable exact-quantity columns to
`movements` transactionally, preserving core schema4 compatibility and all prior
signed deltas. Existing databases without gross fields retain **null** for old
rows; `gross_fungible_details_start` records the upgrade boundary. New complete
category events record exact gross detail. A fresh rescan is needed for missing
older gross data; pruned spent payloads cannot be recreated by guessing.

Spent-output pruning does not delete compact activity. Block apply, rollback,
materialized totals and new fields remain in one transaction. Existing SQLite
online backup/restore preserves them. No separate global activity archive or
transaction-body duplication is introduced.

## Evidence

`test/activity.test.ts` covers mixed categories, >2^53 issuance and complete burns,
unspendable genesis quantities, metadata-only exclusion, stable order/paging,
retention, rollback, snapshot409, partial coverage and legacy upgrade. The real
BCHN harness also checks an actual consensus-accepted input-only burn in this route
and verifies metadata-only exclusion. See `test/regtest.test.ts` and its latest
`.build/reports/regtest-acceptance.json`. Regtest evidence is separate from live
Chipnet and Explorer browser acceptance.
