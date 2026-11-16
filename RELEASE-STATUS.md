# Blaze Indexer — functional delivery and release status

## Private GitHub handoff

The canonical standalone destination is now private `salemkode/cashtokens-indexer`.
Its initial `main` publication uses the user-authorized completely-empty-remote
exception; subsequent work stays on task branches. The older `salemkode/blaze`
repository is retained. Installation instructions point to the standalone repo.

The user requests this source on GitHub for their Linux machine. The private
destination is `salemkode/blaze`, using task branch `feature/cashtokens-indexer`.
The fresh-clone tuning template selects the source Dockerfile so `dist/` and a
host Node installation are not prerequisites for building the container. The
compiled-runtime Dockerfile remains available for verified compiled handoffs.
Linux CI includes serial mock-backed TypeScript tests with native BCHN disabled
and the Python server operations/packaging checks. Secrets, dependencies, local
chain/database data, build artifacts and separate project repositories are
excluded from the Git handoff. Live Linux node/API and user-journey acceptance
remain pending; both readiness flags remain false.

## Current server candidate — six-core/16 GB, resumable daily sessions

The user reports an AMD six-core CPU, 16 GB RAM and about 900 GB disk capacity,
with 12-hour daily operation. Linux distribution/media/free space are unmeasured.
Prepared explicit data/backup paths, compiled-runtime build, separate mainnet/
Chipnet services, archival read-only node configs/systemd template, conservative
cache/CPU/heap limits and a 90 GB ingestion reserve. No macOS node hosting.

[The runbook](deploy/server/RUNBOOK.md) schedules an owned-service graceful stop
at 11.5 hours and resumes retained progress next day; no host poweroff or forced
kill. Bounded read-only acceptance for both networks, warm load probes, restart
and backup/restore checks are provided. Hardware, storage and performance claims
remain provisional until measured on the server.

Node 24.18.0 build, 96 selected source cases and 20 Python operations/packaging
cases pass. A fresh production-only install passed 20 overlapping compiled cases
without dev dependencies. Compose/resource/path checks and shell syntax pass.
No image build, real systemd action, API/node startup, server deployment or live
acceptance occurred. [Exact evidence scope](docs/server-session-preparation-20261116.json).
Both readiness flags remain false. Prior source-only handoffs are superseded by
the new source-and-compiled server handoff; historical artifacts are retained.

## Server handoff — offline preparation verified

The user will run the project on their own server. Separate Linux mainnet and
Chipnet indexer services and complete-history env templates are prepared in the
[server guide](deploy/server/README.md). Node24.18.0 build, Compose/configuration
checks and24 offline database cases pass; no node/API/container was launched.
[Exact verification limits](docs/server-offline-verification-20261116.json).
Actual server execution and synchronized mainnet/Chipnet acceptance remain
unverified; both readiness flags remain false.

## Node hosting decision — 16 November 2026

Follow-up research now covers both mainnet and Chipnet: see
[remote storage research](docs/remote-node-storage-research-20261116.md).
The provisional combined remote budget is 600 GB expandable SSD (500 GB mainnet,
60 GB Chipnet, 40 GB OS/operating headroom), with backups separate and actual
BLAZE database sizes still unmeasured. This is planning, not deployment or
mainnet-transaction authorization.

The user excludes macOS from BCH node hosting because of limited storage. Earlier
local-node windows are superseded: no local start, resume or synchronization.
A read-only process-name check found no bitcoind/Bitcoin-Qt process at this
checkpoint. Existing artifacts are preserved; no cleanup or remote deployment
was performed. A separately assigned remote source/host is needed. The earlier
standalone 50 GiB Chipnet allowance is superseded by the combined budget above;
both remain provisional rather than measured synced footprints.
The historical 25 GiB local admission threshold
was a safety minimum and does not establish total hosting requirements.

## Current result — distinct reviewed attempt refused on measured memory pressure; END

The narrow diagnostic fix passed5 deterministic mocked cases; approved MCP
profile alignment passed8 affected pure contract/isolation cases. Prior wrapper
was privately snapshotted; [new hashes/test record](docs/bounded-prestart-diagnostics-fix-20261116.json)
is additive. No guard/threshold/owner/profile-maturity/runtime API redesign.
Producer profile now depends on actual regtest genesis/chain, owned no-peer argv,
fresh getconnectioncount0/getpeerinfo[] checks; no static caller isolation claim.

The separately reviewed single actual CLI then exited2 at **resource_admission**:
`memory_pressure_not_normal`, pressure2 in BOTH samples. Free space
24,736,260,096→24,736,092,160bytes passed12GiB, swap7,454,913,986 stayed unchanged,
heavy compiler counts0, parent presence/UID/birth/argv/executable facts passed.
[Exact sanitized receipt and actual attempt evidence](docs/bounded-regtest-diagnostic-refusal-20261116.json).
This explains only the NEW attempt; the prior refusal remains unknown.

**END reserved source window**, root notified. No run directory, image/mount,
BCHN/REST/guardian, lease/mining or endpoint was created; no repeated gate/start.
No MCP path handoff or installed-consumer acceptance occurred. No stop receipt
applies because no target process started. Actual cold Chipnet archive/stage2
claim remain untouched. Both readiness flags are **false**; current validating
Chipnet/source and25GiB+root-review full-sync restrictions remain unchanged.

## Historical first actual REGTEST refusal — reason not retained

The single released invocation of the frozen atomic wrapper (lease1200) exited2
with only **"Bounded REGTEST refused before startup; no endpoint advertised."**
No bounded run directory was created; therefore no image/mount/native node/REST/
guardian/lease/mining started. Frozen hashes matched immediately before execution.
No second probe, startup or source edit followed this refusal. No MCP handoff exists.

[Additive actual-refusal evidence](docs/bounded-regtest-actual-refusal-20261116.json).
The exact failed admission stage/reason was **not retained**: the broad CLI catch
suppresses GuardError details and its resource receipt is written only after
admission/runtime checks. This is an observed diagnostic gap; pressure/availability/
ownership/Node version must not be guessed or reconstructed from a new probe.
The minimal grounded fix is sanitized pre-start stage/reason/sample persistence,
not a harness redesign or a blind retry. Historical tested hashes remain unchanged.

Actual ninth-tool consumer acceptance remains **NOT EXECUTED**. No process stop
receipt applies because no target processes started. Actual cold Chipnet image
and stage2 claim are untouched; both readiness flags remain **false**. No validating
Chipnet source or full-sync permission is established;25GiB+root review still apply.

## Historical atomic handoff tests and frozen hashes

After root explicitly ended the OX bootstrap test window, only the four Python
and four JavaScript tiny publication tests ran, serially. **8/8 passed; no fixes
were needed.** Concurrent readers saw complete JSON, final names stayed absent
through paused partial writes/fsync, interrupted producers left no partial final,
and existing file/symlink targets were not replaced.

[Additive test receipt and frozen current hashes](docs/atomic-handoff-test-receipt-20261116.json)
cover wrapper/worker, dedicated publishers and focused test fixtures. Pretest
candidate hashes match. Per-command time-l maximum RSS was30,572,544bytes (Python)
and56,557,568bytes (JS); these are command rusage, not whole-host idle evidence.
Owned tiny fixture allocation is recorded below128 MiB. Node parent/child heap
limits were96 MiB each; commands ran serially.

No actual BCHN/native/HFS/image/mount/API/lease/mining/P2P or resource gate ran.
No unaffected suite/build/pack/install ran. Old native/receipt/profile/runtime
artifacts and global guard.save_new remain unchanged. Actual REGTEST is still
**NOT RELEASED / NOT EXECUTED** until separate root release and a fresh successful
own-source normal-pressure12 GiB gate. Both readiness flags remain **false**;
shared Chipnet and25 GiB+root-review full-sync conditions are unchanged.

## Historical atomic source preparation — tests were deferred

Only `consumer-owner.json` and `connection.json` publication changed, through
separate Python/JS helpers: exclusive same-directory private temp, complete write/
fsync, atomic no-clobber final link, parent fsync and own-temp-only cleanup.
Global guard.save_new, existing readers/ownership, gates, profile/maturity and
runtime API are unchanged. Historical evidence remains intact.

Four Python +four JavaScript tiny fixture/process cases are **written, NOT RUN**.
No syntax/test execution, resource probe, native/datadir/image/mount/API/lease/
mining/P2P, build/pack/install occurred. The bootstrap window is still reserved.
[Source preparation and deferred commands](docs/atomic-handoff-preparation.md).
Current hashes are a pretest snapshot, not a passed-test freeze; additive final
hashes and small test receipt follow only after explicit root test release.

Both readiness flags remain **false**. Actual REGTEST still requires separate
root window release and fresh successful normal-pressure12 GiB gate; shared
Chipnet is unavailable and25 GiB+root review full-sync restrictions remain.

## Historical pinned preview maturity audit

Pinned preview coinbase maturity is **60,000 block ticks**, not unconditionally
100 block heights. Regtest's default2027 activation is1810382400 (May2027), while
Chipnet's is1794744000 (November2026). The stored Electrum MTP is Chipnet context
only; it does not prove failure of101-block funding on pre2027 default regtest.

The bounded worker now verifies the exact native/source pre-rule profile before
funding/mining, caps generation at104 total, checks native maturity facts and raw
sequence/locktime assumptions. It explicitly refuses unknown/post/crossing2027
profiles with precise errors rather than mine1001 blocks or override consensus.
[Exact source audit, anchors and limitations](docs/preview-regtest-maturity-audit.md).

**Six new pure/mock tests passed**, plus worker syntax parsing only. The prior18
checks remain historical, not rerun. No native executable, RPC/resource probe,
image operation, build/download, source CLI, live transaction or sibling edit.
Actual cold archive, historical records and47 runtime API bytes are preserved.
No node/endpoint is advertised; both readiness flags remain **false**.

## Historical bounded REGTEST runner preparation

A separate `scripts/bounded_regtest.py` runner now reuses the fixed-image and
exact-owner guardian/stop helpers with a finite<=20minute lease, private parent
heartbeat, native/REST identity registration, zero external peer traffic,
logs/RSS/free/pressure controls and independent stop paths. Historical serve
runner semantics/records and all47 compiled runtime API bytes remain unchanged.
Admission refuses **before** directory/image/process creation on failed resources.

Future handoff fields align with MCP's actual immutable-archive preparer. The
worker must derive native raw-transaction issuance/input-only>2^53 burn/prevouts,
then compare ready/genesis/schema/tip/activity/pinned paging before emitting a
measured `connection.json`. Snapshot409 stays explicitly NOT_EXECUTED.
No statusverified/known-object/endpoint file was emitted in this preparation.

**10 small control tests +4 pure contract tests +4 affected owner-stop checks
passed.** Mocked control fixtures allocated409,600bytes; no real fixed image,
mount/detach, native process, activity worker, resource probe or heavy/JS build.
[Prepared invocation, boundaries and evidence](docs/bounded-regtest-runner.md).
Full runner and ninth-tool actual-node acceptance remain **unverified**. The prior
REGTEST resource gate still failed pressure; no retry was performed. Both readiness
flags remain **false**, shared Chipnet source **unavailable**. Actual archived
Chipnet image and stage2 process claim remain untouched.

## Historical MCP ninth-tool REGTEST gate

The separately authorized supporting REGTEST gate failed **normal memory pressure**
in both fresh samples (pressure2). Free space14,499,065,856bytes passed12 GiB,
swap stayed stable, and no active heavy compiler/existing native node was observed.
**No datadir, mount, node, REST process or lease was created; no automatic retry.**
This was not a Chipnet quiet/stage2 retry. Actual Chipnet archive stays untouched.

Read-only provenance matched the intended runtime source hash and immutable
installed-artifact SHA256. All47 actual `dist/src` runtime/map/schema members
matched the retained tarball;47 AppleDouble metadata entries were classified
separately, not mistaken for API changes. `/v1/activity` is present. No compile,
install, download or unchanged suite rerun was needed/performed. Raw inventory
is retained. [Exact blocked target/provenance](docs/mcp-activity-regtest-target.json).

There is **no new REGTEST URL or known activity object to advertise**. The existing
legacy harness's30-minute lease/unbounded tempdir defaults were inspected but not
run; a future allowed target needs fixed storage/owner watchdog and<=20minute
lease before it can be offered. MCP RC2 ninth-tool actual-node acceptance remains
missing verification, separate from old eight-tool regtest evidence. Both readiness
flags remain **false** and shared Chipnet connection remains **unavailable**.

## Historical post-cleanup Chipnet quiet gate

The single newly authorized read-only gate ran60.164seconds with
31samples. **Disk admission passed every sample**: minimum
14,939,672,576bytes (13.914 GiB), above the
13.5625 GiB decoded-image+12 GiB reserve+64 MiB threshold. Final free space was
14.041 GiB. Pressure included **both1 and2**, so sustained normal
pressure failed despite a final normal sample. No active compiler was observed;
exact swap values and pressure counts are in [the gate record](docs/chipnet-after-ox-gate.json).

Coordinator was notified at probe start and end. **No repeat probe, actual
restoration, mount, native start or peer connection followed failure.** Actual
stage archive and old receipts remain intact; no actual restoration claim/image
or stage2 process claim exists. No product tests/builds were rerun. Storage
recovery is measured; quietness is not inferred from storage or the last sample.

Both readiness flags remain **false** and the owner connection **unavailable**.
The exact remaining gate is a separately authorized sustained normal-pressure
window, not additional disk reclamation for this bounded restore. Full sync
still requires>=25 GiB free AND concrete root review; it remains unapproved.

## Historical restore/new-inode support checkpoint

`scripts/cold_restore.py` now implements full archive/decoded SHA256+length checks,
exclusive private output, file/parent fsync and atomic no-replace publication of
NEW restoration receipts. Interrupted output/claims stay fail-closed without a
second image or automatic retry. `chipnet_resume.resume_plan` admits restored
identity only through verified custody/config/history and exact bytes, leaving
historical identity/receipts unchanged. Retained archives count toward allocation.

**14 restore +5 affected archive +8 affected resume checks passed** using small
owned synthetic files and mocked quiet/resource admission. Retained related test
allocation5,476,352bytes, below128 MiB. An explicit no-follow census was needed
because rejection fixtures intentionally contain symlinks; guards still reject
those links. [Exact reviewable evidence](docs/cold-restore-support.json).

The actual1.5 GiB stage remains archived: no actual restoration claim/image,
mount, native start, quiet probe or stage2 claim. Real restore/native resume are
**unverified**. Restore needs decoded-image space **plus>=12 GiB postrestore**,
64 MiB headroom and sustained normal-pressure/stable-swap gates. Last observed
9.29 GiB is historical; OX cleanup receipt is pending, not assumed recovered.
Full sync still needs>=25 GiB or assigned suitable storage and root review.
Both readiness flags remain **false** and the owner connection **unavailable**.

## Historical verified cold custody — no node window

Five cleanly detached owned native/process-test images were archived sequentially.
Every complete decompression matched original SHA256 and length, and archives plus
custody records/parents were fsynced before removing only the original encoded
image files. Original receipts/configuration/logs and runtime/source/audit files
remain intact. [Exact custody evidence](docs/cold-image-custody.json) and
[restoration/revalidation procedure](docs/cold-image-custody.md).

Original encoded allocation1,811,939,328bytes is now preserved in7,994,675 archive
body bytes (8,052,736bytes allocated including custody records). Owned net reclaim:
1,803,886,592bytes. Actual shared-host free space changed from8,356,028,416bytes
(7.78 GiB) to9,975,762,944bytes (9.29 GiB); other workloads affect this delta.
Still below12 GiB: no repeated quiet probe, restoration, mount, node or P2P.
One incomplete-exit smoke image was skipped; tiny metadata fixtures/manual quota
proof were excluded. No foreign cleanup or same-volume trash move occurred.

Five custody tests passed; eight resume refusal/budget checks passed after adding
an explicit cold-archive refusal. The historical image inode is unchanged in its
ledger. Original bytes are safe in verified private archives, but restoration and
explicit new-inode reconciliation remain **unimplemented/unverified**; no guard
bypass or automatic restoration/resume exists. The second process attempt remains
unconsumed. Both readiness flags stay **false**, owner connection **unavailable**.
Issuer Identity still requires real validating RPC, complete path discovery and
fresh verified checkpoint/tip/current authority; archival is not source readiness.

## Historical conditional resume resource gate

Root reviewed the prior clean stop and authorized one further bounded stage after
a sustained quiet preflight. The60.179-second observation failed **before any
mount, native start or peer connection**: pressure stayed at warning level2;
last free space4,750,098,432bytes (4.42 GiB), below the12 GiB entry floor and8 GiB
reserve. At that sample another8,134,803,456bytes (7.576 GiB) must become free,
plus normal pressure/stable swap throughout a fresh60-second window. Proposed
library-owner cleanup is not assumed completed or sufficient; no foreign cleanup,
threshold change or repeated launch was performed here.

Implemented checked resume of the same detached image with new private control
records. Prior1,570 receive bytes,783 upload bytes and4.196 seconds are deducted;
old image plus old/new outer allocation is counted once. Original receipts/claims
stay untouched. **8 focused resume tests and4 affected process-control checks
passed**. Actual image reattachment/native resume remains **unverified and blocked**;
these tests are not Chipnet acceptance. No new image, native/heavy build, credential
card or unchanged product-suite rerun. See [current resume evidence](docs/chipnet-resume-control.json).

Both readiness flags remain **false** and the owner connection **unavailable**.
The conditional second process attempt is unconsumed; there is no automatic
retry/resume. Full sync still needs>=25 GiB free or assigned suitable storage and
concrete root review. CashRelay's independently owned API recovery is unrelated
to this node lifecycle; this owner stopped no foreign runtime.

## Historical first bounded native Chipnet stage — 15 November 2026

**The single authorized stage stopped on host memory pressure; it did not produce
a usable Chipnet endpoint.** `testnetFunctionalReady=false`, `publicReleaseReady=false`.
See [exact control/evidence record](docs/chipnet-stage1-control.json) and
[operator lifecycle/limits](docs/owned-node-supervisor.md).

Root accepted the one authenticated im_uname attestation for this scope. Only the
inspected preview daemon was extracted into a new private runtime directory;
archive/member hashes, native version/help and system dependencies checked.
The old29.2.0 installation, OS trust/quarantine and default expiry/activation
policies were preserved. Calin's default-policy DSA rejection remains; no second
verified attestation, reproducibility or developer notarization is claimed.

Independent owner watchdog, exact process/cookie/listener ownership, exclusive
stop receipts, parent heartbeat fallback, fixed-capacity datadir and bounded
one-attempt peer relays are implemented. **20/20 targeted tests passed**, including
process-backed faults, actual ENOSPC/detach and two-stream receive limits. Native
no-peer regtest on a96 MiB image passed with separate native/watchdog exit0 and
clean owner-cookie stop/detach. A prior32 MiB native low-disk refusal was reconciled
and preserved; the low-disk policy was not bypassed.

Fresh stage preflight passed with14,008,975,360 free bytes, normal pressure and
stable swap/no observed heavy compiler. The4.196-second stage checked native
Chipnet genesis and default expiry, then pressure changed to2. The independent
watchdog closed peer relays and stopped the exact node via RPC: native PID26689
and watchdog26697 exited0; owned1536 MiB image detached without force and retained.
Final remote application receive1,570bytes/upload783bytes; owned allocation
1,610,686,464bytes and sampled RSS peak83,525,632bytes. TCP/IP/kernel overhead and
transient sampling overshoot are not hard measured bounds. A fully allocated image
is not downloaded-chain size or a usable full-sync capacity measurement.

Highest RPC-sampled height was0. Peers' announced332538 is untrusted, not a
canonical tip. No split checkpoint, ready txindex, representative CashTokens,
Blaze coverage, REST lease or consumer Chipnet acceptance was established.
The connection stays **unavailable**. The one-attempt claim is consumed: no automatic
retry/resume. Root must review this result and a quiet resource window before any
further scoped attempt; full retained sync additionally requires >=25 GiB free or
assigned suitable storage. A securely supplied ready operator source remains an
alternative; the existing credential card was not reopened.

Previous99-source/19-installed Node24 checks are historical and were not rerun.
The existing tarball is unchanged; the new Python operator tools live in the source
checkout and are not represented by its earlier installed-artifact evidence.

## Historical isolated OpenPGP audit — 15 November 2026

[Detailed audit](docs/chipnet-openpgp-audit.json) resolves the earlier missing-verifier
gap within the later explicit authorization. Exact OpenPGP.js6.3.1 was set up only
in a new owned diagnostic subdirectory, with pinned SHA512 package integrity and
a valid npm registry ECDSA metadata signature. No lifecycle script, global/system
install, user GPG/keychain/trust database or persistent default was changed.

**One authenticated preview checksum signature:** im_uname's actual retained
clear-signed message verifies at its creation time and current time, including the
exact archive hash/name. Full primary fingerprint
`BA578BC691D53253036D02C8A93E50646A20ED95` matches official developer records pinned
to two historical release commits on GitHub, distinct from the preview checksum
host. The current official GitLab key bundle matches the historical bundle. A
historical29.2.0 release signature by the same key also verifies and binds the
known stable ARM64 archive. The signature directly uses the primary key; no
signing subkey was substituted. The certificate is valid/unrevoked in available
material at both times and expires2030-12-31T20:00:00Z. The fingerprint keyserver
returned404 for this key; current revocation evidence is limited to the official
bundle, and unpublished revocations cannot be excluded.

**Calin's preview signature remains unverified:** the full key fingerprint is
corroborated in the same historical records, but unchanged OpenPGP.js default
policy rejects DSA. That rejection is retained, with no algorithm-policy override
or weaker-verifier fallback. It is not a claim of mathematical signature failure.
A current fingerprint-based key refresh yielded no revocation in the available
material; it does not bypass the policy rejection. This is not two verified signatures.

Authenticated checksums, historical identity binding, embedded/source build-ID
consistency and reproducible builds are separate claims. Reproducibility, trusted
macOS developer signing/notarization and runtime consensus behavior remain
unproven. Source still intends the2027 upgrade with the next expiry guard retained;
no BCHN file was extracted/executed/installed/replaced and no config/node/peer/sync
was started. Earlier archive/source/provenance artifacts are preserved. Product
tests were not rerun. Aggregate audit transfers/allocated files plus conservative
overhead stay within250 MiB and the10 GiB free-space floor was checked.

Root must review this bounded result before any further authorization. Existing
storage/load/watchdog/full-sync prerequisites remain. Owner connection stays
**unavailable**; `testnetFunctionalReady=false`, `publicReleaseReady=false`.


## Historical bounded preview artifact verification — 15 November 2026

[Exact provenance and artifact record](docs/chipnet-preview-provenance.json):
**archive integrity and embedded identity are consistent; signature authentication
is incomplete**. The official ARM64 unsigned29.2.1 archive is retained only in a
new owned diagnostic directory. SHA256
`e7f224e27b79f35887fda2900e2aae81c030f290f0fad82338e6061726ba7f15`
matches two available clear-signed checksum payloads and the build-result manifest.
Gzip CRC/full-stream checks passed; static ARM64 Mach-O inspection found
`v29.2.1-3e6827e95`, consistent with the manifest and GitLab full commit
`3e6827e95c7a17497e09ac15556debd116dea1d0`. No files were extracted or executed.
A versioned dylib symlink was inspected as metadata and never followed.

Pinned source retains expiry guards and uses the next Chipnet deadline,
2027-11-15T12:00:00Z, alongside the intended faster-block activation. This is
static intent/consistency evidence, **not runtime consensus proof**. Existing29.2.0
is unchanged and remains expired for current Chipnet. The preview distribution
is labeled unsigned; a Mach-O signature load command alone supplies no developer
trust/notarization. No OpenPGP verifier is available in checked installed tooling.
The two signatures and claimed signer fingerprints are retained but cryptographic
verification and independently authenticated key bindings remain missing.
Same-origin matching digests are not authentication or reproducible-build proof.

The archive is27,745,526 bytes. Counted HTTPS bodies plus retained disk allocation
and a16 MiB protocol/report allowance stay below the250 MiB combined budget;
free space at completion was about13.23 GiB, above the10 GiB floor. Wire protocol
overhead was not independently captured. Exact counts/files/URLs/hashes and the
retained diagnostic record are in the provenance JSON. No runtime/verifier was
installed, no active config/binary was replaced, and no daemon/peer/sync, deletion,
move, purchase or product-test rerun occurred. Collection stops at the explicit
OpenPGP/key-authentication gap for root review. Hosting/resource/watchdog gates
still apply. Owner connection remains **unavailable** and both readiness flags false.


## Read-only local hosting assessment — 15 November 2026

[Machine-readable feasibility](docs/chipnet-hosting-feasibility.json) records the
current hardware/resource observations, primary sources and conditional plan.
**Do not start the installed BCHN29.2.0 on current Chipnet:** official tagged code
expires its default Chipnet RPC at **2026-11-15T12:00:00Z**, now passed. The guard
is wall-clock based, independent of this node's sync progress. No `expire=0`,
RPC-expiry, activation-time or clock override is permitted. Regtest evidence below
is historical support, never current Chipnet-version compatibility.

The maintainers' 14 November notice directs Chipnet operators to an upgrade2027
preview (ARM64 macOS unsigned archive listed); no replacement was downloaded,
installed, signature-verified or executed here. Latest general stable metadata
still names 29.2.0, which does not satisfy the current Chipnet target. A future
build must be tied to verified current rules, commit and maintainer attestations.

Latest snapshot: about 13.63 GiB free, 48 GiB physical RAM, substantial compression
and about11.6 GiB swap used, with foreign builds/emulators active. A public operator
webpage reports4,367,750,091 bytes of retained blocks/undo at 332444; this excludes
chainstate/txindex/Blaze and is neither an assigned RPC source nor independent
chain proof. Total working allocation is uncertain (planning roughly6.04–14.75 GiB).
The conservative full-sync gate is25 GiB free:16 GiB owned allocation plus8 GiB
system reserve and1 GiB stopping margin. This is policy, not a measured physical
minimum. A separate first2 GiB/30-minute measurement stage could fit a12 GiB
start gate, but remains blocked by the expired binary, contention, missing watchdog
and the read-only scope; it cannot promise a synchronized target. Candidate paths,
ports53315–53319, staged receive/time ceilings and clean-stop rules are documented
without creating/binding anything. Polling thresholds are not atomic disk quotas.

No node execution, peer connection, chain/binary download, runtime install/update,
deletion, purchase, relocation, credential card, test/build rerun or sibling edit.
CashRelay's now-disabled old peer is historical evidence only; no fresh proof is
claimed from it. `docs/chipnet-connection.json` remains **unavailable**; both
readiness flags remain false. Earlier99-source/19-installed artifact evidence is
preserved without rerunning it.


testnetFunctionalReady=false
publicReleaseReady=false

Sole implementation/node/endpoint owner: this existing Blaze Indexer thread,
`feature/cashtokens-indexer`, gpt-6.1-sol High. No subagents, new threads, publication,
deployment, protected-ref writes or existing-user-wallet actions. Functional
**Chipnet delivery** is the current gate; public-launch-only polish is deferred.
Historical MVP checkpoints are evidence, never a stopping condition.

## Original-scope feature/evidence matrix

Source: original user handoff, preserved15 referenced query documents in
`docs/explorer-original-workload.json`, analysis and the explicit global-activity
clarification. A query-name fixture is not full product parity. All current source
and real-regtest evidence remains distinct from **actual Chipnet** verification.

| Required journey | Implemented production path | Actual evidence / remaining type of gap | Exact next action |
| --- | --- | --- | --- |
| Height/confirmations and homepage blocks | Native height, exact serialized block size/count/time, pinned network | Native regtest + deterministic reads; missing Chipnet verification | Verify same facts on retained Chipnet source |
| Paged block detail, totals and operations | Native v3 prevouts, selected fee stats, bounded immutable projections, canonical rechecks | Real BCHN exact1000-sat genesis fee and native input total; missing live Chipnet | Run read-only acceptance against assigned source |
| Confirmed/pending tx and address-selected batch | Enriched native reads, legacy fallback, optional known block hash, explicit unavailable inputs | Real consensus transactions, mempool and resolved inputs; no arbitrary BCH address graph | Supply archive/txindex or known block/undo; retain Electrum history |
| Mempool panel | Shared bounded short-lived snapshot, acceptance order, details, eviction/mining races reported | Actual regtest mempool + deterministic race tests; no fake pending row | Verify Chipnet mempool path and consumer journey |
| Global CashTokens activity | Real `GET /v1/activity`, retained mixed-category events, exact gross/net FT deltas, input-only burns, snapshot409, coverage | Focused mixed/>2^53/retention/migration/reorg tests and actual-node burn/exclusion; Explorer reports source/component interoperability | Wire actual Chipnet data/browser through agreed schema; no category alias |
| Holders/address token/NFT balances | Aggregate before paging, exact strings, all NFT capabilities/commitments | Actual BCHN UTXO amount/script/NFT checks and deterministic full sums | Reconcile representative live Chipnet category with observed genesis |
| Supply/NFT/mint counts, genesis and reserve | Materialized totals, category-filtered native genesis outputs, explicit indexed output0 reserve/circulating facts | Real >2^53/all3 capabilities/genesis/reserve tests | Repeat on owned/known Chipnet sample; never label mint authority as issuer trust |
| Category token history incl complete burns | Compact movements, canonical block hash/height/time, full burns | Real burn/reorg and retained-history tests | Verify sample history against Chipnet node |
| Category and non-category metadata identities | Shared publication/configured identities; arbitrary unpublished roots via bounded resumable native resolver and ongoing watches | Real metadata-only transition, historical unpublished-root resolution, reorg invalidation; deterministic CTOR/merge/race tests | Verify actual Chipnet metadata and consumer selection |
| Metadata content integrity/Doctor data | Exact-byte SHA256 + bundled upstream BCMR JSON Schema, bounded cache; safe URI hints | Actual committed regtest registry validation + malformed/hash/schema fixtures | Supply actual published registry bytes; consumer owns HTTPS/IPFS fetch policy |
| Issuer identity/current authority | Discovery and content checks are distinct from authority; no Nostr/signing-key service added | Correctly no issuer certificate from ownership/minting/schema alone | Independent Identity verifier must use verified chain/UTXO/signature evidence |
| Native verification reads for sibling servers | Optional loopback read-only RPC proxy, including `getblockhash`, `getblock`, `getrawtransaction`, `gettxout`, `getindexinfo`; no browser/upstream secrets | Actual native UTXO/txindex proxy checks, failure tests for missing/lagging/pruned/stale-fork indexes | Measure unpruned/IBD-complete source and txindex synced at canonical tip, then publish read URL |
| Bounded dedicated test submissions | Separate upstream role and capability, exact signed-byte/outpoint/expiry/fee approvals, durable no-resubmit journal; mainnet forbidden | Actual regtest accepted sends; loss/restart/fee/network/capability tests | Configure separate Chipnet test-submit role/private approved test identities; no read privilege elevation |
| Migration/backup/restore | Atomic binary v3→v4, explicit supplementary identity/activity migrations, online WAL-inclusive backup, integrity/FK checks, no overwrite restore | Disk-backed migration/restart, failed conversion, backup/restore/catch-up, gross-detail migration tests | Operator consistent backup before valuable-DB upgrade; missing old gross/pruned data requires rescan, not guessed0 |
| Reorg, crash and low storage | Atomic blocks, finite undo floor, conservative resolution-cache invalidation, private writer claim/dead-owner recovery | Real invalidate/reconsider + SIGKILL mid-insertion/after-commit restart + SQLite-full tests | Choose verified checkpoint/separate DB for deep-reorg recovery |
| Production readiness/shutdown | IBD/freshness/catch-up/error probes, storage guard, global RPC limits, size budget and cancellation | Seven source/compiled lifecycle profiles; stale request shutdown cancels60-second RPC | Confirm operational limits on actual host/source; never infer full capacity from a fixture |
| Resource/retention behavior | Binary keys, compact events, bounded undo, detailed read-only census | Synthetic disk-backed2,000-block/32-depth churn retained33 outputs and2,000 events; real-regtest WAL/RSS observations | Measure real Chipnet workload separately; no VPS/production throughput extrapolation |
| Clean Node24 local artifact | Isolated clean install/build, production-only dependencies, compiled lifecycle and contract/gateway tests, tgz+SHA256 | 99/99 full-source tests and19/19 actual extracted-tarball tests passed on Node24.18.0, no dev dependencies/rebuild; external compiled test support injected | Use `.build/reports/clean-install.json` and preserve archive; never publish automatically |
| Docker/configuration | Source/runtime Dockerfiles, nonroot/read-only filesystem, healthcheck, scoped volume/ports/resource settings; sibling dirs excluded | Compose config validated; **operator/runtime gap: configured Docker engine socket unavailable** | Docker build/runtime remains deferred/unverified; not a prerequisite for localAndroid debug bridge |
| Actual shared Chipnet source/REST | Read-only acceptance harness, official fork pins, owner contract and independent native watchdog/fixed storage/receive gate | **20 owner-control tests + real preview smoke/stage**. Actual Chipnet stage stopped on pressure at RPC height0, after local genesis/expiry checks. No post-fork checkpoint, ready txindex, token ingestion or REST | Root reviews consumed stage/resource window; full sync needs >=25GiB or assigned storage. Alternatively configure a ready retained operator source securely; then ingest and lease measured REST |

## Explicit scope and data boundaries

- Required pending BCH transaction reads (including token-bearing transactions) and
  the BCH mempool panel are implemented.
  A token-balance/authchain **mempool overlay** is not requested by the original
  confirmed token queries; confirmed state is never presented as pending balances.
- General BCH address history remains Electrum-backed. The user did not authorize
  replacing it with a duplicate ordinary BCH graph/address archive.
- Global activity metadata-only inclusion policy is explicit. Gross FT fields
  missing from an old database, or for a category with missing initial inputs,
  remain null with coverage flags. Signed observed deltas/history are retained.
- Full arbitrary authbase resolution is an explicit bounded native operation,
  not an unbounded browser scan. Capacity/retained-history limits and202 progress
  are documented. Completed paths are watched and conservatively invalidated on reorg.
- A nonzero global scan boundary can coexist with full targeted identity history
  or complete history of a newly observed category. None implies issuer honesty.
- Actual browser/native Chipnet journeys belong to sibling owners and are not
  certified by this thread's regtest/API evidence.

## Current verified artifacts and prerequisites

Secret-free exact machine evidence: `docs/indexer-functional-evidence.json`.
Runtime source SHA256: `9ce3f2cd606187b5649532010b491e67fdd2e814a38f76b01cf80b3a3f5a5f8d`.
Installed tarball SHA256: `edb1421d41d8d593155b79b86b23e76c7d7a277b80295fb6a09ad2ba1f9b51e3`.


- Latest real-node report: `.build/reports/regtest-acceptance.json` and immutable
  archived reports. Network is explicitly **regtest**, never Chipnet.
- Latest installed-runtime report/artifact: `.build/reports/clean-install.json`.
- Resource report: `.build/reports/retention-check.json`; synthetic scope explicit.
- MCP reported all8 tools/2 resources/cancellation on a clean Node24.0.0 consumer
  against our measured process-backed regtest service. Its final snapshot is done;
  owner stopped that lease/node/indexer. Stopped URL is not advertised as available.
- Actual Chipnet contract: `docs/chipnet-connection.json`, **unavailable**. Independent
  sibling Electrum observations are retained as supporting identity evidence only.
  No full SPV, BCHN method access, funding, native or live transaction claim follows.
- The sole secure RPC URL card timed out without an answer. Per coordinator, no
  duplicate card/node/sync/relocation is started. Required input: retained synced
  Chipnet BCHN read endpoint, unpruned history/undo and `getindexinfo` txindex caught up
  to the canonical tip, then separate approved test-submit
  privileges when actual signed dedicated-test transactions are ready.
- Public-launch-only gates (Docker runtime, broader sustained-load/security/release
  review and user publication approval) remain separate and false.

Full reproduction, private configuration and read/write composition:
[docs/testnet-operations.md](docs/testnet-operations.md).
