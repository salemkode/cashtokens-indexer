# Confirmed authchain discovery contract — v1

**Stable integration endpoint:** `GET /v1/tokens/{category}/authchain?limit=100&offset=0`.
`category` is a plain 64-character display-order transaction hash, the CashTokens
category/authbase, **not** the token-creating transaction ID. No Nostr or issuer
signature verification is performed here. Treat this response as discovery hints.
The independent verifier must obtain transactions and the current output 0 from
its own BCHN, validate every link, verify publication content and verify identity
signatures. Holding tokens or a minting NFT does not establish issuer authority.

Machine-readable JSON Schema: [authchain-api-v1.schema.json](authchain-api-v1.schema.json).
The route validates its response against the Zod source in `src/authchain-contract.ts`.
Regenerate the artifact with `npm run contracts:export`.

## Envelope and freshness

```json
{
  "network": "regtest",
  "confirmed_only": true,
  "indexed_height": 3,
  "data": {
    "category": "<64 lowercase hex>",
    "status": "tracked",
    "head_state": "unspent_at_indexed_tip",
    "discovery_only": true,
    "coverage": {
      "status": "complete",
      "scan_start": 0,
      "indexed_height": 3,
      "indexed_tip": { "height": 3, "hash": "<hex>", "previousHash": "<hex or null>" },
      "reason": null,
      "root_publication_available": true
    },
    "authbase": "<category hex>",
    "authhead": {
      "txid": "<hex>", "output_index": 0, "height": 3, "timestamp": 1700000003,
      "locking_bytecode": "<plain hex>", "value_satoshis": "800",
      "token_category": null, "fungible_token_amount": null,
      "nonfungible_token_capability": null, "nonfungible_token_commitment": null
    },
    "authchain_length": 2,
    "latest_publication": {
      "txid": "<hex>", "status": "published", "locking_bytecode": "<plain hex>",
      "content_hash": "<SHA256 digest hex>", "uris": ["example.org"], "content_verified": false
    },
    "publication_history_complete": true,
    "revisions": [
      { "txid": "<hex>", "previous_txid": "<hex>", "height": 3,
        "timestamp": 1700000003, "migration_index": 2, "publication": { "status": "none" } }
    ],
    "metadata_content_verified": false
  }
}
```

- All byte fields in **this new endpoint** use plain lowercase hex, unlike the
  legacy token output routes' `\\x` formatting. Amounts are exact decimal strings.
- `status`: `tracked`, `burned`, or `incomplete`. `head_state` distinguishes an
  observed burned identity from a spendable identity even when coverage is incomplete.
- A known head plus `incomplete` is permitted: it is a hint with partial coverage.
- If no genesis/head was observed: `data` contains only `category`, `status:
  "incomplete"`, `coverage`, and `reason`. It does not invent a current authority.
- For ordinary indexed discovery, `coverage.status` is `incomplete` for a nonzero scan boundary, including the
  mainnet activation boundary, and for databases migrated from schema 3.
  Pre-activation BCMR publications may exist. Full coverage requires a fresh scan
  from height 0. Migration preserves token state, but cannot recover historical
  metadata-only spends without rescanning. No full historical graph is added.
- `indexed_height` is the **committed token/authchain snapshot**, not BCHN's live
  height. `coverage.indexed_tip.hash` identifies the fork. Check `/readyz` for
  catch-up/error state; reject stale coverage in an authority verifier. `/v1/status`
  includes scan start and undo floor. Reads can become stale immediately after a
  new block, mempool spend or reorg. Never accept this service's state as proof of
  current UTXO ownership.
- Chain links follow the spend of output 0 in **any** input of the next transaction.
  Metadata-only updates, same-block CTOR ordering, identity merges and burns are
  tracked. Root txid is the category; first migration is token genesis.
- `authchain_length` counts observed migrations after the authbase, not including
  the authbase. `revisions` is newest first, `limit` 1–500, `offset` 0–10,000,000.
  Each link includes `previous_txid`; follow pagination to acquire all links.
- `latest_publication` is the latest publication **on this chain**, or the authbase
  publication if observed; null means none observed, not necessarily none ever
  existed. Updates without a publication preserve the prior publication. A
  malformed latest publication **does not** revive an older valid one.
- Publication variants: `{status:"none"}`, `{status:"invalid",locking_bytecode}`,
  or `{status:"published",locking_bytecode,content_hash,uris,content_verified:false}`.
  The lowest output index matching BCMR wins even if malformed. SHA256 is in digest
  byte order. URIs are untrusted raw BCMR URI strings; apply BCMR HTTPS/well-known
  path and IPFS rules in the client. Do not execute or blindly fetch arbitrary URIs.
- The backend does not fetch remote registries. Consumers supply exact registry
  bytes to the separate metadata verification endpoint for SHA256/schema checks;
  `published` alone means structurally valid OP_RETURN, never verified content or
  trustworthy issuer. A signature/evidence service remains separate.
- There is no mempool authchain overlay. Automatic discovery also supports non-category publication roots via `GET /v1/authchains/:authbase`; `AUTHCHAIN_BASES` can register publication-free identities before a scan. Arbitrary historical bases have a bounded resumable `POST /v1/authchains/:authbase/resolve` path. Full targeted history is explicitly marked `coverage.method=targeted_native_scan`, and can be complete despite an incomplete global scan. See [testnet operations](testnet-operations.md).
- 400: invalid URL/query; 500: local index read failed. Missing/partial history uses
  explicit `incomplete`, not a fabricated successful authority resolution.

Protocol source: https://github.com/bitjson/chip-bcmr#zeroth-descendant-transaction-chains
and its metadata registry publication rules (reviewed 2026-11-15).


## Additional implemented paths and coverage

- `GET /v1/tokens/:category/genesis` exposes category-filtered initial quantities
  and native outputs using a known block reference. Unknown unobserved genesis is
 409; a missing optional native node is explicit, never invented output data.
- `GET /v1/tokens/:category/supply` exposes indexed output0 reserve/circulating
  quantities, with null reserve if the chain was not observed. These are facts
  under the stated reserve convention, not an issuer identity/trust proof.
- Generic `GET /v1/authchains/:authbase` supports non-category publication roots,
  including zero-migration roots. Revision0 is the authbase and has
  `previous_txid=null`; later revisions include their predecessor hashes.
- Explicit targeted resolution scans at most100 blocks/request (default10),
  returns202 while incomplete and200 when the entire requested path is resolved.
  Cached complete paths are followed in subsequent blocks and invalidated on
  rollback. Cache is64 roots/one MiB each/10,000 steps. No full graph is stored.
- `POST /v1/authchains/:base/metadata/verify` accepts exact base64 registry bytes;
  GET metadata returns cache/content-required diagnostics. Verified hash/schema
  content is separate from issuer authority, which remains false.
