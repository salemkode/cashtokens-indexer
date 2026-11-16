# Storage-first CashTokens indexing

Reviewed 15 November 2026. This is a capacity and implementation plan, not a measured mainnet storage estimate. No full-chain download, large local fixture, or real-chain performance test was run for this plan.

The earlier 20,000-output in-memory benchmark is an internal implementation experiment only. It establishes neither production latency nor mainnet disk requirements and is excluded from VPS sizing.

## Separate the storage bills

Total hosting space is the sum of distinct components:

```
node retained blocks + undo files
+ node chainstate and node indexes
+ CashTokens database tables and indexes
+ SQLite WAL/SHM and database free pages
+ logs, backup generations and maintenance/recovery headroom
```

A one-terabyte requirement for the CashTokens database has not been established. Conversely, it would be wrong to promise a small VPS capacity without real token counts and actual database measurements. Moving an archival node to another host avoids its local disk cost; it does not eliminate its cost overall.

A pruned BCHN still validates ordinary BCH and keeps chainstate for the entire BCH UTXO set. Pruning discards eligible historical block/undo files, not all non-token chainstate. A token-only external index has a different storage footprint from the validating node.

## What the current prototype actually stores

| Data | Retention and growth |
| --- | --- |
| Block hash, parent, height, timestamp | Every scanned block; no full block bodies |
| Transactions and category movements | Token transactions, including complete burns; no ordinary BCH transaction archive |
| Token outputs | Every historical token output, including spent outputs |
| Category/genesis records | Categories encountered |
| Category and holder totals | Current aggregated balances |
| Secondary indexes | Duplicated identifiers and searchable keys |
| WAL/free pages | Transactional and SQLite allocation overhead |

The index is token-specific, but its current schema is **not yet a minimum-storage design**. Spent output payloads remain forever. Hashes/categories are 64-character hex text, scripts/commitments are hex text, and repeated keys appear in multiple indexes. This must be included in capacity accounting.

## Direct extraction already available

The scanner calls BCHN `getblock(hash, 2)`, reads native token data and transaction inputs, commits only token effects, and discards the full response. It does not call `getrawtransaction` and does not require `txindex`.

BCHN sources: [getblock](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/rpc/blockchain.cpp#L1064), [tokenData serialization](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/core_write.cpp#L413). Sources are pinned to BCHN commit 07576013c91ff4a3a74acd85f189c69121cdad1b, not Bitcoin Core RPC documentation.

Two-pass CTOR handling remains necessary: a spender may precede its creator within a block. Transactions that consume token UTXOs without producing token outputs must also be retained as burns.

For a later ingestion optimization, compare verbose RPC decoding against raw-block streaming and a native BCHN event/export hook. These could reduce JSON/network/CPU overhead, but no speed claim follows until equivalent real-data runs measure them. The first useful change is reducing retained data, not changing languages prematurely.

## Deployment paths

**Available now: remote extraction source.** Run the token service on a small host, set `BCH_RPC_URL` to an existing authenticated BCHN retaining the needed history, and persist only the token database locally. Full block responses are processed transiently. This still transfers and reads block data, but does not require a local copy of the blockchain. A remote source is trusted for validation, availability, and completeness; canonical hashes/checkpoints do not replace independent validation.

`SERVE_BCH_API=false` omits ordinary BCH REST routes entirely. With those routes enabled, `BCH_HISTORY_RPC_URL` can point to a separate archival source. Its credentials are independent. When absent, the existing shared-RPC behavior is preserved. An absent/failed history source is not silently replaced with the extraction source.

**Planned: coordinated pruned BCHN.** Validate blocks, durably commit extracted token effects, retain the required reorg/recovery window, and then prune the processed prefix. This still downloads and validates history once, but need not retain the full archive simultaneously. BCHN supports [manual pruning](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/init.cpp#L576) and [pruneblockchain](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/rpc/blockchain.cpp#L1103). Pruning operates on eligible block/undo file pairs, so a configured target is not a strict whole-node disk ceiling.

A pruning coordinator is not implemented and must not be enabled casually: automatic pruning can outrun extraction; manual pruning can accumulate unprocessed blocks if the indexer stops. It needs disk watermarks, ingestion backpressure, durable progress, restart recovery, and a defined deep-reorg procedure. No pruning RPC was added to this service's read-only allowlist.

BCHN [rejects pruning combined with txindex](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/init.cpp#L1665). Complete historical BCH explorer pages therefore need an archival data source or a reduced feature contract when the extraction node is pruned. Removing Chaingraph does not make historical BCH data free to reconstruct.

## Native UTXO scanning and a possible exporter

BCHN `scantxoutset` supports `tok(<category>)` for known 64-hex token categories. It returns current UTXOs and token data at an identified chain snapshot. It scans the UTXO database; it belongs in bootstrap/auditing work, not the live balance request path. [Parser and RPC implementation](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/rpc/blockchain.cpp#L2611).

That parser does not provide an all-token wildcard. A registry list is not a complete category catalog. `gettxoutsetinfo` provides aggregate UTXO statistics, not the complete token inventory. This pinned BCHN source does not register Bitcoin Core's `dumptxoutset` or `getblockfilter` methods; do not base this design on their assumed availability. [RPC table](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/rpc/blockchain.cpp#L3138).

A proposed BCHN-side exporter could stream every token-bearing UTXO directly from a consistent chainstate snapshot, with its block hash and count/integrity manifest. It would avoid a separate historical graph index for **current balances**. It is a node extension to build and audit, not an existing RPC or implemented feature here. A current-state snapshot cannot recover old burns, spent NFTs, genesis transactions, or historical transfers. Full history still needs a scan; reorgs below a snapshot boundary need a defined rebuild/recovery path.

## Next storage format

Preserve the explorer's full token history using a compact event/transaction representation, while separating it from live outputs and reorg recovery:

1. Live token UTXOs and category/holder totals.
2. Compact token history needed by the chosen API, including burns and genesis. Any NFT provenance/old-commitment features must have their necessary history retained explicitly.
3. A per-block undo journal with an explicit retention depth and a hard failure/recovery path beyond it.
4. Binary transaction/category hashes and script/commitment bytes; integer references to interned identifiers where useful. A 64-character hex hash represents 32 raw bytes, but this alone does not halve the whole database.
5. Reusable IDs and indexes selected from actual query plans rather than every available field.

Full history still grows with token activity. A current-state-only mode could discard older history, but would have a reduced API contract. Neither is implemented by simply deleting old rows from today's schema: foreign keys, genesis/first-seen records, totals triggers, and rollback currently depend on those rows.

Keep exact arithmetic. Leaf token quantities fit the protocol limit, but intermediate totals in an insert-before-spend CTOR pass can exceed signed 64-bit even when final supply is valid. Binary key compaction is safe to prioritize; blindly replacing BigInt totals with SQLite INTEGER addition is not.

## Measurement and real-data validation

The read-only inspector reports an existing database; it creates no synthetic benchmark:

```sh
npm run storage-report -- --database /path/to/cashtokens.sqlite
# Optional expensive table counts and page attribution:
npm run storage-report -- --database /path/to/cashtokens.sqlite --details
```

Run it on the machine already holding a pilot or full index and transfer only its small JSON report. It must not checkpoint WAL, VACUUM, change indexes, or copy/compact the database automatically. Live-writer file observations are not a consistent backup. The default report avoids scanning every data row; detailed inspection can be expensive. A SQLite reader may create or update shared-memory locking sidecars; the inspector requests no database writes and does not force a checkpoint.

After a compiled build (including the production image), use `npm run storage-report:built -- --database /path/to/cashtokens.sqlite` instead; it does not require the development TypeScript runner.

Before selecting a VPS, collect real counts/distributions: live and historical token outputs, spent-output churn, token transactions including burns, category movements, categories, holder pairs, distinct scripts and their byte lengths, NFT commitment lengths, database/index pages, and WAL high-water behavior. Include the required backup generations and available maintenance headroom separately. A short quiet window is insufficient; include active token categories, NFT-heavy traffic, bursts, burns and long-lived state.

A capacity model is:

```
retained token records at the chosen chain height
  × measured physical bytes per record for that actual schema/distribution
+ measured materialized state and secondary indexes
+ observed WAL/recovery/backup requirements
```

Do not extrapolate a whole chain from one category, assume every block has equal token activity, or double-count index pages already included in a measured database file. Global counts can be collected by a streaming scan on an existing node host without retaining a second full block archive, but tracking live outputs/spenders still needs working state.

Real correctness acceptance requires a fixed canonical block range and valid starting state (activation boundary or a verified/trusted snapshot). Starting a later sample with an empty index loses earlier token inputs and cannot prove complete balances or burns. Cross-check selected known categories with BCHN's native UTXO scan at the same block hash. Full-state completeness requires more than a few sampled categories.

Then test disk-backed ingestion/restart, reorg rollback, interruption during commit, node outage, low-disk stopping, sustained writes/reads, peak WAL, and recovery. Report warm/cold API latency, backlog catch-up and peak resource usage separately. No production speed, index size, or hosting-price conclusion is valid until those measurements exist.

## Status after this pass

Implemented: separate optional historical BCH RPC, token-only serving configuration, read-only storage-report tooling, and cleanup of orphaned zero category totals after rollback. Existing token extraction is already direct BCHN RPC. Small tests verify these behaviors only.

Not implemented or measured: compact binary/undo retention redesign, pruning coordinator, all-token chainstate exporter, complete real-data capacity census, or production performance acceptance. No one-terabyte download or new large local dataset was started.

## Implementation update — direct owner, 2026-11-15

The earlier “not implemented” list above describes the previous snapshot. Schema
4 now implements binary keys, retained compact movement history and finite
spent-output undo retention; see [storage-v4.md](storage-v4.md). Automatic narrow
CashTokens authchain tracking is implemented, with explicit incomplete coverage
for old-schema migration or nonzero starts; see [authchain-api-v1.md](authchain-api-v1.md).
The all-token snapshot exporter, production capacity census and live-node
performance acceptance remain unimplemented/unmeasured. No chain download began.
