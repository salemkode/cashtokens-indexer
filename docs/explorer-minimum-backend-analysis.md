# What the explorer actually requires from a Chaingraph replacement

Analyzed 15 November 2026 against **the original explorer**, commit [87af1dfe67d918df9c29c7996e9be11b4b5183e4](https://github.com/salemkode/explorer/tree/87af1dfe67d918df9c29c7996e9be11b4b5183e4). The current rewritten UI is not used as the definition of feature completeness. The original query documents are preserved in [explorer-original-workload.json](explorer-original-workload.json).

## Decision

Build a single application beside BCHN: a small RPC adapter plus an incremental CashTokens/identity index. Read ordinary chain facts from the node, answer token-wide lookups from shared indexed state, and retain only relationships the node cannot look up. Neither a general transaction graph nor a second BCH transaction-body archive is required by this explorer.

The current prototype is not yet the shortest implementation or a feature-equivalent replacement. Its existing RPC adapter does avoid a second BCH archive, but over-fetches inputs and block statistics. Its token indexes already answer many token views; it still lacks the original automatic authchain capability and removed related UI features.

The work is to simplify those reads, compact the necessary state, and restore missing original capabilities. A new test platform, generic query engine, distributed database, replication layer, or additional deployment architecture does not follow from this analysis.

## The original workload

Seventeen GraphQL operations are defined; fifteen have application references. These are inventory counts, **not** percentages of runtime cost or proof of other applications' coverage. `LastTransaction` and `GetOpreturn` are unused definitions and add no implementation requirement. Doctor reuses `GetAuthChains`; it does not introduce a separate graph query.

| Original operation | Actual requirement | Shortest appropriate data path |
| --- | --- | --- |
| `GetLastBlock` | Current height for confirmation calculations | Cached `getblockchaininfo.blocks` or `getblockcount`; hash/header reads are unnecessary for this consumer |
| `GetBlocks` | Homepage height, timestamp, tx count, exact block size | Native block metadata; do not compute every selected-but-unused aggregate |
| `GetBlock` | Header facts, input/output totals/counts, nine paged transaction rows | Native block/statistics with only displayed fields; input metadata from enriched native reads where available |
| `GetTx` | Confirmed/mempool tx, value, timestamp, confirmations, input/output address/token operations | Native transaction plus inclusion/tip; enrich inputs through BCHN rather than separate application-level parent lookups when supported |
| `GetTransactions` | Eight transaction records selected from existing address history | Bounded native transaction reads; no second transaction-body store |
| `MonitorMempools` | Count, accepted ordering, nine tx previews with from/to details and expansion | Shared bounded mempool view plus selected native transaction reads; no permanent mempool-history table |
| `GetTokenAddress` | Holder scripts and complete fungible balances | Shared live token UTXOs plus category/script aggregate; aggregate before pagination |
| `GetTokenTxs` | Category txid, block height and timestamp | Compact category-to-transaction history; BCH input/output totals fetched by the old query are unused here |
| `GetTokenChild` | Current NFT owner script, capability, commitment and child metadata; table/gallery | Live NFT UTXOs by category; commitment metadata from the metadata resolver |
| `GetAddressNFTs` | NFT category/capability/commitment, display name/icon | The same live token state indexed by script, plus metadata |
| `GetAddressTokens` | Categories and complete balances, display name/decimals | The same script/category aggregates, plus metadata |
| `GetUseNonBurnTokens` | Current spendable fungible supply | Category totals row |
| `GetSupplyNFTs` | NFT count under an explicitly defined capability policy | The same category totals, without a paginated full-output scan |
| `GetMintingToken` | Whether a live minting-capability output exists | The same category totals/minting count |
| `GetAuthChains` | Genesis facts, current identity/authhead facts, latest authorized metadata publication, content integrity | A narrow tracked-identity outpoint/spender/publication index plus content verification; not a general graph |

Source: [original query module](https://github.com/salemkode/explorer/blob/87af1dfe67d918df9c29c7996e9be11b4b5183e4/src/module/chaingraph.ts), [supply](https://github.com/salemkode/explorer/blob/87af1dfe67d918df9c29c7996e9be11b4b5183e4/src/hooks/nonSpentToken.ts), [NFT count](https://github.com/salemkode/explorer/blob/87af1dfe67d918df9c29c7996e9be11b4b5183e4/src/hooks/nftSupply.ts), [minting](https://github.com/salemkode/explorer/blob/87af1dfe67d918df9c29c7996e9be11b4b5183e4/src/hooks/activeMinting.ts).

## The main shortcut: address history was already separate

The original [address page](https://github.com/salemkode/explorer/blob/87af1dfe67d918df9c29c7996e9be11b4b5183e4/src/pages/address/%5Baddress%5D.vue#L83) gets BCH address balance/history from Electrum. Chaingraph expands the resulting transaction IDs. Replacing Chaingraph therefore does **not** require building another general BCH address-history index.

For the present replacement, keep that existing interface. If the product must also eliminate Electrum and serve all BCH address history from this one application, that is an explicit extra index: script/address to transaction references and balance effects across ordinary BCH activity. Standard BCHN does not provide arbitrary historical address lookup. The single-host budget must account for a locally hosted existing address index if one is used. This distinction must not be hidden behind a claim that the CashTokens-only database alone serves every address feature.

## Native reads the prototype should use more effectively

The BCHN findings below are pinned to [07576013c91ff4a3a74acd85f189c69121cdad1b](https://github.com/bitcoin-cash-node/bitcoin-cash-node/tree/07576013c91ff4a3a74acd85f189c69121cdad1b). Capability and availability matter; these are not measured latency claims.

### Enriched transaction inputs

The prototype calls `getrawtransaction(txid, true)` and then fetches each distinct parent transaction in `normalizeTransaction()`. BCHN supports **numeric verbosity 2**, which can supply input values/scripts/token data itself. That is the first candidate for removing application-level parent RPC fan-out, while preserving the original visible transaction detail.

The response shapes differ: enriched raw transactions place `value`, `scriptPubKey`, and `tokenData` directly on each input; `getblock(hash, 3)` places them under `vin.prevout`. Treat these as separate validated boundaries. Missing information must trigger an explicit availability/fallback policy, not invented zero values.

`getrawtransaction` can also accept a known block hash to locate a confirmed transaction without a global txindex, when that block is retained. A transaction URL containing only an arbitrary txid still needs a location source or the native txindex. A token event can retain its own block reference; this does not locate every ordinary BCH transaction.

In this BCHN implementation, verbosity 2 without txindex first attempts the containing block and its undo data. With txindex, or when that path fails, it resolves distinct parents internally; missing parents can make the request fail. Mempool inputs also require resolution. Enriched RPC responses reduce application round trips. They do not eliminate node-side disk reads or make old/pruned input data universally available. [Raw transaction implementation](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/rpc/rawtransaction.cpp#L217), [serialization](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/core_write.cpp#L342).

### Block metadata and transaction pages

The old homepage template displays height/time/count/size. Its GraphQL document also selects unrelated totals. The prototype currently issues header/statistics reads for this page and returns `size_bytes: null`: it performs unnecessary work while losing a displayed field.

`getblock(hash, 3)` can provide nested input prevouts for retained current-best-chain blocks with available undo. If undo is unavailable, input information/fees can be omitted; preserve an explicit fallback/unavailable result. It still serializes every transaction.

`getblock(hash, 1)` includes exact serialized size and transaction IDs. `getblockheader` accepts a height directly in this BCHN version, avoiding a separate height-to-hash call when header data alone suffices, but it does **not** contain block size. `getblockstats.total_size` excludes the coinbase and header and cannot stand in for the serialized size.

The least storage approach is to retain tiny immutable block summaries when blocks are already decoded during ingestion, or keep a bounded summary cache and obtain native metadata on a miss. A block summary is not a copied transaction graph. Native lookup remains necessary for heights outside the index scan boundary.

For block transaction pagination, the prototype reparses the complete verbose block and recomputes totals on every page. A bounded byte-budgeted cache of immutable projections keyed by block hash can avoid repeating that work. Canonical-chain status remains separately checked and reorg-sensitive.

Do not assume that `getblock(1)` plus many block-hash-scoped raw-transaction requests is automatically faster: the node may reread the same block for each lookup. Choose between an enriched whole-block read and sparse reads based on actual node I/O and page density. Do not persist full block bodies merely to avoid designing a bounded cache. [Block/header RPCs](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/rpc/blockchain.cpp#L869).

### Select statistics; do not request everything

`statsFor()` currently requests all `getblockstats` fields. That asks BCHN to compute unrelated statistics, including medians/fee-rate information, and may require undo reads. Use the selected-stat argument for fields actually required by the block page, or derive tiny summaries during the existing scan. The homepage needs none of these aggregate statistics. [Selected-stat controls](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/07576013c91ff4a3a74acd85f189c69121cdad1b/src/rpc/blockchain.cpp#L2326).

A shared backend tip cache can use a simple node poll or one `waitfornewblock` listener. Browsers should consume that shared state; they do not need independent node listeners. The original global-height consumer requires only height, not a header read on each request.

### Keep list/detail work proportional

The original transaction list already renders from-address summaries before expansion. It is not correct to call every input field unused and silently remove sender details. For a single-input transaction that summary needs the previous output's script. Multi-input previews can display their input count while complete operations load on expansion, if that UI behavior is intentionally preserved through a preview/detail contract. Prefer native enriched reads first; introduce a new lazy-loading flow only if real payload measurements justify it.

Unlocking bytecode and separate duplicated input value fields are not used by the relevant original components. Token-history rows do not use BCH input/output totals. Do not normalize/store every available node field merely because an earlier GraphQL selection returned it.

## What the small persistent index actually needs

These are logical records, not a requirement to create a separate service or query engine for each:

- **Category/genesis facts:** category, genesis transaction/block reference, category-filtered initial quantities and required genesis capabilities/scripts. Do not sum other categories in the same transaction.
- **Live token outputs:** outpoint, category, amount, NFT capability/commitment and locking script; searchable by category and script.
- **Current aggregates:** category supply/NFT/minting counts and category/script holder balances. These answer several views without rescanning all outputs.
- **Compact token history:** category to transaction/block references, including complete burns; retain event quantities or NFT provenance only where the intended history contract needs them. Full BCH transaction bodies remain node-backed.
- **Tracked metadata identities/publications:** category/base identity, relevant identity outpoint/head, migrations needed for provenance, latest publication pointer/hash/URI and required current identity-output facts. Cache fetched registry bytes by their committed content hash and verify those bytes.
- **Atomic chain cursor and undo:** apply/rollback the above together, respect CTOR, and define deep-reorg recovery before bounding old spent payload retention.

`gettxout` cannot identify the spender of an already-spent output. A metadata migration may contain no token input or output, so the current token-only transaction filter misses it. During the same block scan, follow the relevant identity outpoints even for such non-token transactions. This is the specific missing relationship to index, rather than retaining every BCH input/output edge. Implement the BCMR authorization rules precisely; a public registry entry or a matching user-supplied hash is not authorization.

Native `scantxoutset tok(category)` is useful for occasional checks of known categories, not a per-request backend or a complete category-discovery mechanism. It scans chainstate and cannot reconstruct historical transfers/burns. No general all-token wildcard is provided by that parser.

Multiple narrow tables are acceptable when their records are token-specific and serve different necessary lookups. The storage problem is repeatedly retaining broad historical payloads and redundant keys. Keep useful category/holder aggregates; replace repeated hex keys with compact binary/ID references and replace forever-retained spent payloads with compact history plus defined undo retention. This is a schema change, not a safe `DELETE` on the current tables.

## Work the prototype currently repeats

Let `U` mean distinct parent transactions not already cached, and `P` the displayed page size. Ignoring shared network checks, the current adapter structurally performs:

- Transaction detail: one raw transaction read, up to `U` parent reads, and up to one header read.
- Block page: one whole-block read, one statistics read, up to `U` external-parent reads, and possibly a height lookup.
- Mempool page: a whole verbose mempool read, `P` transaction reads, up to `U` parent reads, and node metadata.

These are request structures, not benchmark results. A concurrency cap protects the node but does not remove this repeated work. Native enriched reads, selected statistics, shared tip/mempool state and bounded immutable projections address the causes directly. A larger SQL graph or an additional caching service is not necessary.

Token extraction's verbosity-2 block read itself can ask BCHN for undo information to include fees that the token scanner does not need. A raw-block parser could later avoid that decoding/undo path, at the cost of parser complexity and RPC hex overhead. It is an optional measured optimization, not a prerequisite or a reason to build a new node exporter first.

## Original behavior still missing from the rewritten explorer

The current migration is **not** the reference for calling the replacement complete. It removed:

- Automatic authorized-publication discovery and content-hash verification; category-only Doctor diagnosis.
- Genesis supply/type and authhead reserve facts; original reserve/circulating/owner displays.
- Per-token metadata registry selection and the transaction BCMR panel.
- NFT table/gallery selection, child-specific metadata and owner presentation.
- The displayed token-history timestamp, although the backend returns it.
- Exact block size on the homepage, although BCHN can provide it.

Some of these are UI reuse/restoration, not new backend indexes. Automatic authchain tracking is a genuine backend gap. Genesis facts are small one-time category records. Restoring the original arithmetic and labels literally is not the goal: genesis recipient is not necessarily current authority; reserve/circulating supply is an application-defined calculation, not a universal consensus value.

The original also has bugs that must be corrected rather than preserved: aggregation after UTXO pagination, Number-based token arithmetic, missing network filters in aggregate hooks, immutable-only NFT counting presented as broad supply, token history omitting complete burns, genesis sums including other categories, and nonreactive authchain query inputs. These corrections should be explicit semantic differences.

## Implementation order derived from these findings

1. **Simplify the node adapter.** Use supported enriched reads, minimal block metadata and selected statistics. Preserve original visible fields. Avoid repeated parent RPCs and repeated block-page decoding where the native data/caches permit it.
2. **Make shared token records compact.** Keep current category/holder indexes; retain only required history facts, binary identifiers and a defined undo journal. Stop treating token-history rows as miniature BCH transaction summaries.
3. **Add the narrow metadata-identity index.** Restore automatic authorized metadata, genesis/reserve facts and provenance-based Doctor behavior without creating a graph of unrelated BCH transactions.
4. **Restore original frontend capabilities against that API.** Reuse existing display components where possible. Keep existing Electrum address integration within the stated replacement boundary; account for it explicitly in a strict all-local single-host deployment.

The original explorer supplies concrete checks for this work. The next action is these specific corrections, not building an abstract acceptance framework first. No application source or runtime behavior was changed for this analysis, and no mainnet download, new performance claim, or capacity estimate was produced.

## Implementation update — 2026-11-15

The direct owner has implemented native verbosity-2 inputs, verbosity-3 block
prevouts (legacy fallback when unsupported), height-only reads, exact homepage
block size through native block metadata, fee-only selected statistics, and
bounded decoded block reuse with a fresh canonical header check on each page.
Schema 4 uses binary keys and bounded spent-output undo; see
[storage-v4.md](storage-v4.md). The narrow category authchain endpoint tracks
metadata-only spends and publishes explicit coverage, without asserting issuer
ownership; see [authchain-api-v1.md](authchain-api-v1.md).

`test/explorer-acceptance.test.ts` matches all 15 application-referenced operation
names from the preserved workload to concrete REST assertions on a bounded
BCHN-shaped fixture. It does not run the explorer browser, verify live chain state,
resolve arbitrary non-category authbases, or certify metadata contents. Independent
consumer verification and actual-chain performance/storage acceptance remain
required. General BCH address history remains Electrum's responsibility.
