# Schema 4: retained state, migration and recovery

## Records and exact quantities

- Transaction/category hashes, scripts and NFT commitments are SQLite **BLOBs**.
  API boundaries convert to the existing display hex formats. Hashes occupy 32
  payload bytes, not 64 text bytes. This is not a whole-database size reduction claim.
- Token history retains compact transaction references (height, position, output
  BCH total), category movement deltas and first-observed/verified genesis links.
  Ordinary BCH transaction bodies and full ordinary input/output graphs are not
  archived in SQLite. Metadata-only transactions retain only identity steps and
  publication data; they do not require ordinary BCH history rows.
- Live balances and category totals retain exact decimal **TEXT** quantities and
  BigInt arithmetic. SQLite INTEGER/SUM cannot safely replace those aggregates:
  intermediate CTOR insert-before-spend totals may exceed signed 64-bit.
- There is no separate varint codec, identifier-interning layer or transaction-body
  compression implementation. Binary keys and minimal event references are the
  current compaction, not a claim of an optimal final format.

## Finite recovery window

`UNDO_DEPTH` defaults to 288 (range 1–100000). Inside that window, spent token
output rows serve as the **undo journal**, with spender transaction references.
Queries use live outputs/materialized balances; old spent and unspendable outputs
are deleted after their spending/creation height expires. The cleanup runs inside
block commit and visits the newly expired heights, avoiding a full history scan
on every block. Compact movement/genesis history remains indefinitely.

`/v1/status.undo_floor` is a monotonic boundary. Rollback can remove blocks with
height **greater** than this boundary. Rolling back the boundary itself throws
`Reorganization exceeds retained undo history; rescan into a new database`.
`/readyz` becomes 503 when sync encounters that error. Increasing the configured
window after pruning cannot lower the saved floor or recreate deleted outputs.
Depth bounds chain heights, not bytes; undo space depends on token activity.

BCHN remains the trusted consensus source. An indexed snapshot can lag a reorg or
mempool spend; independent authority verification must use its own current node.

## Schema 3 → 4

Before starting an upgrade against a valuable database, take an SQLite online
backup, or stop the **owning** writer and back up its consistent database. Do not
copy only the database file while WAL writes run. No migration against a user's
live dataset was performed during this development pass.

On startup, version 3 keys are converted transactionally to BLOBs, checked with
`PRAGMA foreign_key_check`, and the version advances to 4. Existing column
**declarations** can still say TEXT: SQLite BLOB storage is verified by
`typeof(column)` and `length(column)`. New writes consistently bind binary values.
The migration briefly disables FK enforcement on its private connection outside
the transaction; the completed graph is validated before commit and enforcement
is restored even on failure. A failed conversion rolls back all converted keys
and version changes. Existing token totals/history/rollback references survive.
The first new block applies the selected undo retention to historical spent rows.

Migration can require substantial temporary database/WAL space and startup time;
it is not an online zero-space rewrite. The file is not automatically VACUUMed or
checkpointed to force physical shrinkage. Deleting rows frees reusable pages;
use the read-only storage report to distinguish logical pages, file bytes and WAL.
Schemas 1/2 require a rescan; unsupported future versions are rejected.

Schema 3 did not track metadata-only spends. Therefore migrated databases report
`authchain_scan_start = old_tip + 1` and **incomplete** authchain coverage. Existing
categories without a reconstructed chain remain incomplete. A fresh scan from 0
is the complete metadata-history path. Starting from mainnet CashTokens activation
still skips possible earlier authbase publications and reports incomplete metadata
history, even though token balances can be complete. No silent history backfill or
large blockchain download is started by migration.

## Operating checks

```sh
npm run typecheck
npm test
npm run build
npm run storage-report -- --database /path/to/existing/index.sqlite --details
# Or after build, without development dependencies:
npm run storage-report:built -- --database /path/to/existing/index.sqlite --details
```

Tests cover disk-backed version-3 migration/reopen, failed conversion rollback,
exact amounts, blank NFT commitments, FK checks, pruning/restart, retained CTOR
undo and failure beyond the floor. These are bounded deterministic tests, not
mainnet storage or sustained throughput measurements. No full-chain capacity,
VPS budget, production latency, low-disk endurance or power-loss guarantee has
been measured. Electrum still supplies general BCH address history.


## Supplementary feature migrations (core schema4 unchanged)

Identity index version1 adds shared publication/configured identity nodes/edges;
old databases record their own `identity_scan_start` and do not fabricate earlier
metadata history. The bounded requested-authbase resolution cache stores only
selected identity facts; rollback clears derived caches conservatively.
Activity feature version1 adds nullable `fungible_issued`/`fungible_burned` to compact
movements in a transaction. Earlier signed deltas survive; missing old gross data
stays explicitly null and the upgrade boundary is recorded. Exact new events,
including input-only burns, are independent of spent-output retention.
Online backup/restore includes these tables and fields. Detailed storage reports
include their table counts; no ordinary BCH transaction-body archive is introduced.
