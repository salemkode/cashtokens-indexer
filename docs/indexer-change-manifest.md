# Blaze Indexer — execution change manifest

Root backend ownership only, `feature/cashtokens-indexer`. This repository was
already largely untracked; Git status is not an attribution list. All existing
work is preserved. No sibling repositories/coordinator registry files changed.

- Runtime and storage: `src/api.ts`, `src/bch.ts`, `src/config.ts`, `src/main.ts`,
  `src/rpc.ts`, `src/sync.ts`, `src/store.ts`, `src/storage.ts`, `src/migration.ts`.
- New/extended backend modules: `src/authchain.ts`, `src/authchain-contract.ts`,
  `src/identities.ts`, `src/authchain-resolution.ts`, `src/metadata.ts`,
  `src/bcmr-v2.schema.json`, `src/activity.ts`, `src/activity-contract.ts`,
  `src/network.ts`, `src/backup.ts`, `src/ownership.ts`, `src/rpc-proxy.ts`,
  `src/test-broadcast.ts`, `src/archive-readiness.ts`.
- Tests: authchain, identities, resolver, activity, backup, crash, regtest,
  RPC proxy/test-submit/archive-readiness, original explorer acceptance, BCH,
  main lifecycle, migration, retention, storage, store and sync under `test/`;
  owned-node/scenario/crash helpers and bounded supporting regtest server.
- Tooling: `scripts/database.ts`, `scripts/clean-install.ts`, `scripts/reports.ts`,
  `scripts/retention-check.ts`, `scripts/chipnet-acceptance.ts`,
  `scripts/export-contracts.ts`.
- Configuration/artifacts: `package.json`, `package-lock.json`, `tsconfig.json`,
  `.env.example`, `.dockerignore`, `Dockerfile`, `Dockerfile.runtime`, `compose.yaml`.
- Documentation: README/WORK-STATUS/PROJECT-HANDOFF/RELEASE-STATUS; backend activity,
  authchain/schema/provenance/storage/original-query/operations docs and the
  secret-free `docs/chipnet-connection.json` contract.

Ignored `.build/` contains the verified native binary, retained immutable evidence
reports and local compiled tarballs. No publication or launch is authorized by an
artifact's presence. Historical and current evidence are distinguished in status.

Current owner diagnostic tooling (separate from the previously tested Node tarball):
`scripts/owned_node.py`, `scripts/owned_node_smoke.py`, `scripts/owned_node_measure.py`,
`scripts/bounded_store.py`, `scripts/peer_byte_gate.py`, `test/test_owned_node.py`,
`test/helpers/owned_process_fixture.py`; `package.json` adds the targeted supervisor
command and `.gitignore` excludes Python caches. Operator/control records:
`docs/owned-node-supervisor.md`, `docs/chipnet-stage1-control.json`, current
connection/feasibility/provenance plus status/handoff/release pointers. Existing
preview/archive/OpenPGP audit and old native software are preserved. No sibling
repository, device, Metro, coordinator registry or existing active service changed.

Conditional continuation adds `scripts/chipnet_resume.py`, `test/test_chipnet_resume.py` and `docs/chipnet-resume-control.json`; updates measurement/owner guard/storage binding for retained-image provenance, cumulative byte/time/allocation budgets and sustained quiet preflight. Actual native resume is not yet verified.

Authorized cold custody adds `scripts/cold_archive.py`, `test/test_cold_archive.py`, `docs/cold-image-custody.json`/`.md`; resume now explicitly refuses absent/cold-archived images. Only five verified inactive encoded images were removed after durable lossless archival; original receipt/source/runtime files remain. No restoration or mount occurred.

Restore admission adds `scripts/cold_restore.py`, `test/test_cold_restore.py`, `docs/cold-restore-support.json`; updates cold idle inspection for an absent destination, resume explicit new-inode proof and archive-inclusive allocation accounting in `scripts/owned_node.py`. Only small synthetic restores were executed; actual archives and historical receipts were untouched.

Bounded consumer preparation adds `scripts/bounded_regtest.py`, `scripts/bounded-regtest-worker.mjs`, `scripts/bounded-regtest-contract.mjs`, their small tests and `docs/bounded-regtest-runner` records. `scripts/owned_node.py` gains opt-in bounded-regtest heartbeat/peer/consumer ownership and separate exact-consumer stop receipts. Historical serve runner and src/dist API bytes are unchanged; no real target ran.

Pinned preview audit adds `scripts/preview-regtest-profile.mjs`, its pure test and `docs/preview-regtest-maturity-audit` records; bounded producer now verifies pre2027 source/native maturity profile, caps all mining104, and refuses unsupported epochs before mining. No native/API/sibling/runtime47 changes or operation occurred.

Narrow atomic publication preparation adds `scripts/atomic_handoff.py`/`atomic-handoff.mjs`, four focused test/fixture files and `docs/atomic-handoff-preparation` records. Only two bounded wrapper/worker call sites change; readers and global guard.save_new are unchanged. NEW TEST EXECUTION DEFERRED pending root END OX bootstrap; pretest hashes are not tested freeze evidence.

Narrow pre-start diagnostics adds `scripts/prestart_diagnostics.py` and deterministic mocks; wrapper snapshots old a182 source then records only allowlisted stages/reasons/measured fields outside native datadir. Explicit isolation alignment adds native-derived producer profile and affected pure tests. New reviewed actual attempt refused pressure2 before startup, reserved window ENDED. Old unknown refusal and all immutable evidence remain intact.
