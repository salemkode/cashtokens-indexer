# Blaze Projects

Work runs directly in each project's existing top-level T3 Code execution thread on **gpt-6.1-sol / High**, except **Focus Garden**, whose existing execution stays on **Opus 5.5 / High** at the user’s request. Open a thread to follow its commands, updates, tests, and blockers. The Arabic coordinator thread manages ownership and integration; no subagents replace these project threads.

Current delivery target: complete required functionality working end to end on **BCH Chipnet**, with recorded network and browser/native evidence and repeatable setup. The user will polish afterward. `testnetFunctionalReady` is separate from public-release readiness; fixtures and regtest remain supporting evidence. Current acceptance plan: [testnet-delivery-plan.json](docs/testnet-delivery-plan.json).

| Project | Purpose | Execution thread |
| --- | --- | --- |
| [Blaze Indexer](.) | Lightweight BCH and CashTokens data backend. | [Blaze Indexer — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:02e5f777423e80c22415328bea9c31f0508bdd728a8ba9efb77442c89a8de5f8) |
| [OX Wallet](projects/xo-wallet) | Send, receive, and connect apps to a BCH wallet. | [OX Wallet — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:8a135c3b11b8b68bf16797c77e5082c0e0cebd9505911cc1fe827d131edb2e95) |
| [CashRelay](projects/stripe-cash) | Invoices and independently verified merchant payments. | [CashRelay — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:9ace652f9571904416006610ee7239f07a9db8e1b39ad871d61852c737b4ede9) |
| [CashCart](projects/cashcart) | Stores, products, and a contract-managed NFT for each order. | [CashCart — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:fa7b48a922f6f90d8de168e45f23ee5afc1e37d97685a9eac09b4d8bb50c12cd) |
| [BCH Explorer](projects/explorer) | Browse transactions, tokens, NFTs, and chain activity. | [BCH Explorer — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:699574de7b47d7615f9ba90fde3e3a16c0216316fc4ed706f6c596d31c0ef5d6) |
| [Issuer Identity](projects/token-issuer-identity) | Prove current issuer authority and link it to an identity. | [Issuer Identity — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:3d87e45418b4130a42c9a105488fcedb763bbb72a98f44803587c0e58c83f441) |
| [Focus Garden](projects/focus-garden) | One focus-and-garden product for web and Expo. | [Focus Garden — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:58deccbf2adddf77f0f46e26f5ee843598a8bbe4eb384960636d691d5952124e) |
| [BCH MCP](projects/bch-mcp) | Read-only AI tools for BCH and CashTokens data. | [BCH MCP — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:8f7e096ac174b93c5f6a5cb622ee411a20adc9837e991310b879f0ecb31abafe) |
| [React Native Libauth](projects/react-native-libauth) | Native cryptography and wallet APIs for React Native. | [React Native Libauth — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:a6e7bab7db6f550e3c14787e0e0dc6c566aa140a2e1bee7bafbe7760fc5f77f1) |
| [Jamiyah](projects/jamiyah) | Family feature source for OX: shared accounts, recovery, approvals and rotating savings. | [Jamiyah — Execution](t3-thread://v2/cd548199-0437-465a-8ac9-7bbb4a94b98c/mcp:launch:ffb8affafdfe3583f1ed4c78bda79f0a54f4ad064d99bf8ef7d4459fee59c13a) |

The Family product belongs inside the existing OX Wallet: minimal onboarding, Add money, Use money and Requests using its current Home and native sheets. Jamiyah owns the reusable feature and contract source; OX owns host integration and native QA. The older [Jamiyah simulation](http://127.0.0.1:4319) remains a reference with sample funds and a simulated clock, not a separate wallet product.

## Current functional checkpoint

Snapshot from the existing execution threads through 16 November 2026. Test counts below describe their named cohorts; they are not combined totals. Full Chipnet and public-release readiness remain false where required journeys are still missing.

| Project | Concrete progress | Next required step |
| --- | --- | --- |
| Blaze Indexer | Native regtest and packaged runtime verified; compiled activity API matches the retained artifact. | Bounded harness is implemented; actual execution needs a healthy resource window. Retained Chipnet source remains unavailable. |
| OX Wallet | Actual native invoice1042 paid and confirmed, journal restored, browser message discovery passed; rc.3 offline host source173 tests; installed native app remains rc.2. | Authenticated Argent control and cold-boot address/path/history/encrypted journal now verified on5558. Wizard UI restore and encrypted disconnect observed; strict post-restore peer response, current rc3 native bundle, live assets and iOS remain. |
| CashRelay | Native payment/merchant fulfillment and three course-pass transfers verified;45 new offline issuer tests pass. | Native identity/token address now recovered and verified; guarded plain-asset activation adapter preparation is in progress. No new assets issued. |
| CashCart |122 tests, content/CID storage and all three fixture fulfillment flows pass; production merchant/buyer authentication and unsigned order recovery observed. | Actual retained Chipnet reads/write route, dedicated coins and two-party confirmed settlement/recovery. |
| BCH Explorer |466 suite cases and4 separate packaging checks; portable export hashes verified, updated UI on8791. | Actual measured Blaze objects/coverage and live issuer authority context. |
| Issuer Identity |78-test local protocol/browser continuation and actual OX address-control discovery recorded. | Real issuer category/authchain, validating source, dedicated NIP07 identities and approved relay/publication. |
| Focus Garden | Opus restored the iOS QA preview on8083; initial signed Android APK installed but exposed an R8 launch crash, now being fixed by Opus. | Corrected APK runtime acceptance; Account Holder Apple agreement. Cleanup wrongly deleted50 intermediate Swift interfaces; no matching recovery copies, anomaly retained, original final archive/APK preserved. |
| BCH MCP | Immutable RC2 exposes9 tools/2 resources;20 focused tests and packed consumer pass. | Two released source attempts created no node; the latest records pressure2 refusal. Exact-archive consumer awaits an actual measured target; Chipnet remains required. |
| React Native Libauth | Immutable rc.3 offline candidate:70 affected host/39 packed-consumer cases; separate unsigned-vault reviewer74 tests. Native evidence remains artifact-specific. | OX offline policy/journal adoption is verified; native/token/platform acceptance remains. |
| Jamiyah | OX-shaped experience design and presentation tests; existing V4 contract/admission/journal proofs preserved. Actual reusable RN feature and OX host integration are in progress. | Native edit/inspect/fix loop in the existing OX app, then real source/enrollment/specific signing integration. Recovery, governance, savings and minority rights remain in scope. |

Detailed evidence and ownership: [current continuation record](docs/max-completion-2026-11-15.json). Local previews are usable demonstrations and do not establish complete Chipnet acceptance.

## Status and continuity

T3 Code is the source of live execution state. Local index/status files are snapshots, not a live monitor. Each project maintains `PROJECT-HANDOFF.md` and, during implementation, `WORK-STATUS.md`. Project/thread names, execution responses and current documentation use English; only the coordinator conversation remains Arabic. Historical user messages remain intact.

Machine-readable registry: [projects.json](projects.json). Coordination record: [sol-high-program.json](docs/sol-high-program.json).

## Historical Focus Garden consolidation

One canonical project contains `packages/dapp` (web), `packages/mobile` (Expo), `packages/garden` (shared original island models), and `packages/contracts` (v3 covenant). Consolidation checks and the Android build passed; owned-device visual verification was not established. Funding and native v3 transaction work has a separate subsequent checkpoint in the execution thread. [Consolidation evidence](projects/focus-garden/docs/expo-consolidation.md).

The previous Expo project is archived, with its files/history retained at [projects/focus-garden-native](projects/focus-garden-native). There are ten active projects; the archive is not another active implementation.

## Working rules

Read the target project's instructions and handoff before editing. Preserve its branch, dirty changes, device/session, worktree, and Metro port. No automatic deployments, mainnet transactions, PR merges, or protection bypasses. `main` and `master` remain protected; the user merges manually. Starting implementation does not establish product completion or live-chain readiness.
