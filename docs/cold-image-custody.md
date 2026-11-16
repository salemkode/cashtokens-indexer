# Cold diagnostic image custody

Five inactive owner diagnostic images were losslessly gzip-archived on15 November
2026. This operation preserves the complete encoded image bytes, including all
chain/test data, rather than selecting or deleting inner filesystem contents.
The custody directory is0700; archives and records are0600. No mount, extraction,
restoration, native process or P2P connection occurred.

Exact paths, old inode/length/SHA256, archive SHA256, before/after free space and
full-decompression verification are in [the custody record](cold-image-custody.json).
Original run receipts, configuration, logs and source/runtime/audit artifacts were
preserved. Each JSON receipt's hash was checked after archival. The earlier32 MiB
failed native smoke was skipped because its integration exit receipt is missing;
tiny synthetic inputs and the manual quota-proof image were excluded.

`scripts/cold_archive.py` uses a single sequential compression worker and1 MiB
streaming reads. The aggregate encoded-body cap is127 MiB, reserving1 MiB of the
128 MiB allowance for records/allocation rounding. Every original was private,
regular, sole-link, matched to its fixed-store ledger, detached and without foreign
open handles or a matching native process. Its device/inode/size/UID/mode/mtime/
ctime were checked before compression and again before removal.

For each image, the archive was fully decompressed as a stream into SHA256/length
verification, without writing decoded image bytes to disk. Archive data, verified
custody record and their parent were fsynced **before** unlinking only the original
encoded image file. The original parent was then fsynced and an exclusive removal
receipt was written/fsynced. A failure, changed identity, open handle, failed fsync,
size cap or checksum mismatch retains the original. No automatic retry or broad
cleanup is provided. Synthetic unit checks exercise success and refusal paths.

The observed host free-space delta is not identical to the owned net allocation
reclaimed, because unrelated workloads share the filesystem. Neither measurement
establishes a quiet memory window. The final observed free space remained below
12 GiB; no additional quiet preflight was run.

## Restoration and explicit inode reconciliation — not executed

The existing resume guard intentionally refuses the missing encoded image. The
historical `fixed-store.json` inode remains unchanged. Do not edit the ledger to
make the new image pass, silently remove an ownership check, reuse a stale device
identifier or invoke `hdiutil` against the archive.

A later separately authorized restoration must:

1. Confirm enough current storage for the full uncompressed length **while keeping
   the archive** and all required system reserve; check there is no native process,
   mounted association or existing original destination. Current gates do not pass.
2. Check private archive/custody ownership and hashes against the exact recorded
   archive SHA256 and original SHA256/length. Stream into a new exclusive0600 file
   in the original owned directory, with an output-length cap. Refuse overwrite.
   Hash every decoded byte; never trust gzip CRC or filename alone.
3. Fsync the restored file and parent. Re-read/hash the restored file completely;
   require the original SHA256/length, mode/UID, regular-file/sole-link properties
   and expected original location. Preserve the verified archive and all records.
4. Write a **new exclusive reconciliation record** linking original custody/archive
   hashes, old device/inode, restored device/inode, exact byte identity and unchanged
   historical receipt hashes. Leave original fixed-store/exit/receipt records intact.
   The implemented `cold_restore.verify_restored` admission now consumes an
   explicit new receipt after verifying that chain, full restored bytes and
   unchanged config/history. It supplies an effective identity to a NEW resume
   plan; old ledgers stay unchanged. Small-fixture checks passed; actual native
   restoration remains unexecuted. Restoration alone is not resume readiness.
5. Only after that reviewed reconciliation support, the full sustained>=60-second
   resource gate and remaining one-stage authorization checks pass, prepare a new
   private control run and checked attachment. Retain prior receive/upload/time/
   allocation counters and all existing stop rules. No automatic launch follows
   restoration. Full sync still needs>=25 GiB or assigned storage plus root review.

This document is a procedure for future review, not proof that restoration or
native resume has been executed. No decompressed image was recreated now.

## Reviewable restore implementation (not executed on actual archives)

See [support/evidence](cold-restore-support.json). The explicit Python entry point
is `cold_restore.restore_image(custody_path, quiet_report)`. There is no automatic
restore/mount/launch CLI or retry. A private sustained quiet report is required,
with every sample passing, at least60seconds, at most3-second observation gaps,
and a final sample no older than10seconds. Current free space must cover all
decoded bytes plus12GiB reserve and64MiB headroom. Resource admission is rechecked
while streaming; test mocks do not change these production thresholds.

A durable `restoration-claim.json` precedes creation of the exclusive0600 original
destination. Errors leave claim/partial output intact; neither can be overwritten
or automatically resumed. After decoded SHA/length and an independent reread,
file and directory fsync, a complete new `restoration-receipt.json` is atomically
published without replacing a name. Pending receipt hard links from an interrupted
publication also fail closed. No historical receipt is edited.

The resume verifier checks original custody/removal records and hashes, old
fixed-store identity, restored exact bytes/private new identity, unchanged original
receipt hashes/config and restoration claim hash. It returns a NEW effective
identity, leaving the original ledger immutable. Retained compressed archive and
custody records also count toward the cumulative allocation guard. Native image
reattachment or real-node crash recovery of this restoration path has not yet
been exercised. The actual archive was not restored during these tests.
