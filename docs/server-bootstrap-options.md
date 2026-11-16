# Downloading an existing BCH node database

Research checkpoint: 16 November 2026. Applies to the Linux server; macOS node
hosting remains excluded. This document does not start a node or select a
snapshot provider.

A complete, compatible BCHN database can be transferred from an already
synchronized node, then caught up with newer blocks. However, the research did
not identify a current, maintainer-published ready-to-use BCHN database snapshot
for either mainnet or Chipnet. No third-party download has been verified or
approved by this document.

## Complete database transfer

A consistent snapshot needs the relevant block/undo files, block index,
chainstate and, for historical transaction serving, the synchronized transaction
index. Obtain them from a trusted source after a clean shutdown or an explicitly
consistent database snapshot. Check the network, compatible software/database
versions, recorded height/hash, provenance and transfer checksums before use.
Use a new destination and retain existing data until the import is accepted.

Do not import another operator's wallets, RPC cookies, credentials, private keys
or configuration. Keep the server's own network-specific configuration and
credentials. Mainnet and Chipnet require separate data and compatible binaries.

Using the supplied chainstate avoids replaying the complete history locally by
trusting the producer's state. Matching checksums and recent chain/checkpoint
checks do not independently prove that every historical state transition was
validated correctly. Rebuilding chainstate from historical blocks restores that
local reconstruction work and its time/energy cost.

## Downloaded raw blocks

BCHN's `-loadblock` imports external block files; `-reindex` rebuilds state and
indexes from retained block files. Raw-block delivery does not eliminate
validation or database construction. A bootstrap archive may improve transfer
convenience, but no speed advantage over ordinary peer synchronization was
measured here. Ordinary synchronization already downloads blocks rather than
fetching transactions individually.

## Alternative fast-sync implementations

BCHD advertises FastSync with incomplete older block retention. Its configuration
also documents that its BCMR index cannot be combined with FastSync or pruning.
This is not an established replacement for BLAZE's BCHN-backed historical reads.
Changing node implementation requires testing consensus/version compatibility,
RPC methods and response shapes, CashTokens data, network pins and historical
coverage. A current-state UTXO snapshot cannot recreate burns, spent NFT history
or earlier metadata publications.

Bitcoin Core/BTC and Bitcoin ABC/eCash snapshot instructions are not evidence
that the same snapshot formats or RPCs work with BCHN. In particular, the pinned
BCHN v29.2.0 blockchain RPC table does not expose Core's `loadtxoutset` operation.
Chipnet still needs its separately compatible current release/preview.

## BLAZE's database is separate

BLAZE reads whole decoded blocks using `getblock(hash, 2)` and stores its own
token/metadata history in SQLite. A copied BCHN database does not supply that
index. To avoid both initial jobs on the new machine, obtain a consistent BCHN
snapshot and a compatible BLAZE online backup from a trusted prepared host.
Verify the BLAZE network, schema, start height, metadata coverage and canonical
saved tip; retain enough node history to resume the index safely.

Without a suitable snapshot, an authenticated remote archival BCHN source lets
BLAZE backfill without running the node's initial synchronization on this server.
This transfers infrastructure cost and trust to that source; BLAZE still scans
history unless a suitable application database backup is also provided.

After any transfer, run the network/UTXO/archive acceptance, bounded read tests,
clean stop/resume and backup/restore checks in the
[server runbook](../deploy/server/RUNBOOK.md). No live snapshot import, chain
download, speed measurement or readiness promotion occurred during this research.

## Sources

- [BCHN data files](https://docs.bitcoincashnode.org/doc/files/)
- [BCHN import/reindex options](https://docs.bitcoincashnode.org/doc/cli/bitcoind/)
- [Pinned BCHN v29.2.0 blockchain RPC source](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/v29.2.0/src/rpc/blockchain.cpp)
- [BCHD FastSync description](https://bchd.cash/)
- [BCHD configuration and index restrictions](https://github.com/gcash/bchd/blob/master/sample-bchd.conf)
- [Chipnet upgrade guidance, 14 November 2026](https://bitcoincashnode.org/nl/newsroom/2026-11-14_opinion_on_faster_blocktime)
