# Atomic bounded-runner handoffs — preparation history and focused test result

Scope is limited to publication of `consumer-owner.json` by the Python wrapper
and `connection.json` by the JavaScript worker. No runtime API, profile, maturity,
resource gate, reader or owner admission semantics changed. Global
`owned_node.save_new` is unchanged. Historical artifacts and test receipts stay
immutable. This race was found by source inspection; no native failure is claimed.

`atomic_handoff.publish_handoff` and `atomic-handoff.mjs:publishHandoff` require
an existing private0700 run directory owned by the producer. They create only an
exclusive0600 same-directory random temporary name, write complete JSON (including
short-write handling), fsync that file and directory, atomically hard-link the
final name with **no replacement**, then fsync the parent. They remove only a
temporary name whose device/inode/UID matches the file they created, and fsync the
parent again. Existing final entries, including symlinks, are never overwritten.
No rename-overwrite, broad cleanup, retry or alternate reader path is introduced.

A reader may see either no final entry or the complete fsynced JSON; temporary
names are not reader inputs. A producer crash before publication may leave its
private partial temporary file, but no incomplete final handoff. An error after
the atomic link can leave a complete final entry; it remains no-clobber and must
not be automatically retried or removed as if it were a temporary file. Directory
fsync errors are propagated. The existing private-run/single-producer ownership
contract remains the boundary; this is not a framework for shared foreign paths.

## Deferred focused tests

**NOT EXECUTED.** Root must explicitly end the OX bootstrap window before the
new tests run. No syntax/test/worker/native execution or resource probe was done
in this preparation. Tiny fixture producers use32 KiB synthetic JSON, no node,
HTTP service, wallet, image, mount, datadir or actual handoff objects.

Future serial commands, only after the separate test release:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s test -p 'test_atomic_handoff.py' -v
node --max-old-space-size=96 --test --test-concurrency=1 test/atomic-handoff.test.mjs
```

Four Python and four JavaScript cases are written. Each language has a process
fixture paused after a partial temporary write and after file fsync: the parent
checks final-name absence at both points and runs a concurrent reader through
publication. Other cases crash the producer before linking and verify no partial
final, or pre-create a final file/symlink and verify no replacement. Only freshly
spawned fixture handles are used for timeout cleanup; no foreign process is
signaled. Fixture files are private and small; Node child heap is capped at96 MiB.
Tests must remain serial within512 MiB memory and128 MiB temporary allocation.
Budget/result evidence and additive final source hashes are deferred until release.

Current candidate hashes are a **pretest source snapshot**, not a passed-test
freeze: [preparation record](atomic-handoff-preparation.json). The old18-check
bounded cohort and six maturity checks are historical and not rerun. No current
verified endpoint or fresh resource gate is implied. Actual REGTEST needs separate
root native-window release and a successful fresh normal-pressure12 GiB source
gate. Chipnet remains unavailable; full sync still needs25 GiB and root review.

## Later explicit test release — 16 November 2026

Root released only the focused serial tests after END OX bootstrap. Four Python
and four JavaScript tests passed without code correction. Current wrapper/worker/
publisher/test hashes match the pretest candidate and are frozen in the additive
[test receipt](atomic-handoff-test-receipt-20261116.json). Earlier deferred-state
records above describe preparation at its recorded time and remain intact. No
unaffected suites or native/resource execution occurred. This result does not
release actual REGTEST; a separate root window and source resource gate remain.
