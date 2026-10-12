# WL-2.40 Forms + Coupons combined integration acceptance

2026-10-12, Codex, Integration Owner. **PASS — verified local eight-module integration candidate.** Services remains required. This is not a Production release. Canonical Second Brain and Security notes remain read-only.

## 1. Exact source, integration and ownership

- Worktree: `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-White-Label-Integration`.
- Branch: `integrate/forms-enforcement-20261012`; kept separate from main.
- Accepted Forms baseline and exact integration parent: `ed6acdaa8e9ff6d3624e1fc626ba1829025bea5b`.
- Accepted Coupons source: `3b16d2eb0dc1c23d7206505d785e02bc5f39ffe1`; its exact parent/common merge base is `adad483cb23e3fc8c98c399ee2034f8b45ad1017`.
- **Verified feature integration commit: `bde6ae40038049b00399dca6e26f838ad2948efe`.** Its single parent is the accepted Forms baseline. The documentation delivery commit containing this report follows it; its exact SHA is supplied in the final delivery report.
- Integration method: reviewed the complete endpoint tree difference and the 19-file Coupons parent-to-feature delta, applied the accepted source with a three-way `cherry-pick --no-commit`, composed seven conflicts explicitly, added reviewed forward corrections, ran acceptance, then committed the 23-file verified feature. No merge/rebase/reset, whole-file ours/theirs resolution or source-worktree mutation occurred.

Startup consulted configured Global OS/Active Worktree Protection, Skills Index, project Brain/Current State/Decisions/Known Issues/Architecture/relevant Log and Security notes, Forms implementation/integration handoffs, Coupons final acceptance, parallel integration controls/56-signature inventory and cross-module orchestration. Global OS resolves to the configured Anthony OS vault's `10 Templates/Coding Agent OS/CODING AGENT OPERATING SYSTEM.md`; canonical memory resolves to its `02 Projects/Wolf Forge Platform/AI Memory`, with sibling Security. The accepted Forms repository checkpoint supersedes stale canonical mandatory-Forms/Coupons facts. Historical QA was not counted as current acceptance.

Initial branch/HEAD matched exactly, Coupons existed locally, no integration app/test process or Git lock/operation was active, and the only tracked modification was machine-local `supabase/config.toml`. One integration writer performed mutations; three independent native reviewers remained read-only.

## 2. Complete changed-file inventory

Feature commit: **23 files, 3,656 insertions, 18 deletions**. Documentation delivery adds the two final files below, for **25 files relative to the accepted Forms baseline**.

```text
docs/coupons-implementation-handoff.md
docs/coupons-proposed-memory-update.md
src/app/(internal)/coupons/layout.tsx
src/app/actions/coupons.ts
src/app/globals.css
src/components/coupons/coupon-access-boundary.tsx
src/components/subscriptions/subscription-plan-form.tsx
src/domain/white-label/preview.ts
src/lib/errors/map-database-error.ts
src/tests/coupons-access-action.test.ts
src/tests/coupons-module-enforcement.test.tsx
src/tests/forms-integration-boundary.test.ts
src/tests/white-label-builder.test.tsx
supabase/migrations/20261011172233_coupons_module_enforcement.sql
supabase/migrations/20261011172236_forms_coupons_integration.sql
supabase/migrations/20261011172237_combined_authority_after_wait.sql
supabase/tests/database/129_white_label_drafts.test.sql
supabase/tests/database/130_published_module_enforcement.test.sql
supabase/tests/database/131_investment_intent_module_enforcement.test.sql
supabase/tests/database/132_projects_module_enforcement.test.sql
supabase/tests/database/133_tickets_module_enforcement.test.sql
supabase/tests/database/135_invoices_module_enforcement.test.sql
supabase/tests/database/137_coupons_module_enforcement.test.sql
docs/forms-coupons-integration-acceptance-20261012.md
docs/forms-coupons-proposed-memory-20261012.md
```

No package/lockfile/configuration/type-contract replacement was imported. Coupon RPC signatures already existed. Accepted Forms migration 232, corrections 234/235, Forms application boundaries and suite 136 remain unchanged. Coupons233's Git blob exactly matches accepted source (`11b4625c10b2fb4629cd0cee8e4b907010df48c3`). The local Supabase configuration, `.env.local`, generated dev route imports, private evidence and credentials are excluded.

## 3. Migration and function composition

Reserved order and suites are preserved: `20261011172232_forms_module_enforcement.sql` / **136**, then `20261011172233_coupons_module_enforcement.sql` / **137**. Forms234/235 follow Coupons233; coordinator-owned forward236/237 follow them. No accepted migration was renumbered or edited. Suite 138 remains provisionally reserved for later Services work.

Only two whole-function definitions overlap between the Forms and Coupons branches:

| Final boundary | Composition |
| --- | --- |
| `private.published_module_set_valid(text[])` | 236 retains duplicate/null/unknown/shape checks, catalog dependencies, Projects→Tickets, Subscriptions→Invoices and Services requirement, while making Forms and Coupons independently optional with the six predecessors. Services-only validation remains subject to actual publication obligation checks. |
| `private.profile_has_permission_in_tenant(uuid,uuid,text)` | 236 retains membership/preset/override conjunction and earlier module gates, adds both Forms management and Coupon view/manage publication predicates, and preserves scoped Forms history permissions. Owner/Platform Admin does not bypass lifecycle or membership. |

Forms234/235 remain authoritative for fresh post-wait Forms authority, secured history/projections, collection policies, pointer redaction and the original unpublished trusted-bootstrap exception. Coupons notification list/mark bodies retain the Forms financial-parent helper and existing Invoice/Subscription/Project/Ticket predicates while adding actual-Coupon visibility.

Forward237 retains complete predecessor bodies and adds current authority after waits in these **eight full signatures**:

```text
public.app_create_coupon(uuid,jsonb)
public.app_update_coupon(uuid,jsonb)
public.app_archive_coupon(uuid)
public.app_update_subscription_terms(uuid,uuid,jsonb)
private.validate_tenant_module_publication()
private.publish_tenant_modules(uuid,integer,text[],text)
public.app_purchase_service_with_balance(uuid,uuid,text)
public.app_pay_invoice_with_wallet(uuid,uuid,text)
```

Coupon creation rechecks after its request-key advisory lock; update/archive after the Coupon row lock. Subscription terms rechecks exact `subscriptions.manage` after Tenant/request/parent waits. Both publication boundaries recheck Platform Admin after Tenant waits, with missing-Tenant `P0002` checked before `PERFORM` changes `FOUND`. Store/wallet retain their exact capability and fresh Company checks after request/lifecycle/parent/wallet waits. Financial calculations, saved snapshots, replay ordering and fulfillment effects were neither removed nor reordered.

The new unaccepted237 prototype was corrected during this task inside the authorized synthetic cluster and its source/registry reconciled; accepted migrations were not reapplied or altered. Final156 fresh source replay proves the final file chain independently of that iterative upgrade path. [PostgreSQL replacement semantics](https://www.postgresql.org/docs/17/sql-createfunction.html) and [Supabase migration ordering](https://supabase.com/docs/guides/deployment/database-migrations) were checked alongside installed command help and local source.

## 4. Guarded database identity and executable acceptance

Project: `Wolf-Forge-Forms-Integration-20261012`.
PostgreSQL system identifier: **7695548610956316710**.
Container ID: `f342df9ed2eca359ef61399c7ec599435b41d683ae57b65908e426695e7ea505`.
Container/volume: `supabase_db_Wolf-Forge-Forms-Integration-20261012`.
Network: `supabase_network_Wolf-Forge-Forms-Integration-20261012`.
Data mount: `/var/lib/docker/volumes/supabase_db_Wolf-Forge-Forms-Integration-20261012/_data` → `/var/lib/postgresql/data`.
API59321, DB59322, shadow59320, Studio59323, mail59324, analytics reservation59327, pooler reservation59329, edge8583, app3014. Gateway/network/DB port ownership and exact container/mount identity were checked. The guarded local environment has no hosted fallback.

The primary `postgres` database was upgraded from the accepted153-migration Forms predecessor without reset. Final clean database **`wf240_final_20261012`** was created inside this same verified isolated cluster using native Supabase schemas only, then replayed **all156 application migrations from source in chronological order**. It was not cloned from the final application schema. Before suites: zero Auth users,59 source-seeded Services,156 registry entries, latest237. Earlier synthetic databases and financial records were preserved.

Readback verifies **55 final source bodies**, all **56 predecessor signature ACL/configuration/security-definer contracts**, **54 new-helper privilege denials** across primary/fresh databases (nine helpers × three API roles × two databases),10 Forms guards, five Forms collection policies and retained restricted raw Project-pointer grants. Complete function, trigger and RLS policy definitions match between fresh replay and upgrade. Private helpers retain empty search paths and explicit revocations; no broad Tenant-helper execution was granted.

## 5. Combined security and financial contract

- Eight optional modules narrow existing authority; drafts stay inert. Services remains mandatory. Both publication boundaries preserve Project/Ticket/Subscription/Invoice obligation and revision safeguards; disabling never closes, cancels, archives, reprices or repairs obligations.
- Forms OFF freezes collection, assignments, schema management and corrections. Currently authorized response history remains scoped by Tenant/Company/profile/membership/archive. Guest exact replay returns only acknowledgement ID; no guest response read. Re-enable does not re-pin stranded assignments or convert prior Forms-only Contact answers. Tickets-OFF Contact submissions stay nongenerative.
- Coupons OFF denies new management, validation/quotes, calculation/redemption and trusted benefits. Issued Invoice discounts and exact historical Subscription Coupon ID/cents/duration/applicability remain authoritative. Trusted complete-transition, item and cycle guards refuse omitted/extra/rewound benefits, sequence/date resets, backdating and evidence truncation. Sequence-based first-payment behavior remains unchanged; Invoice issuance adds no redemption.
- Accepted financial replay precedes new Coupon gates and economic effects, and still requires current actor, operation, payload, capability, Tenant, Company and parent visibility. Same-ID replay never adds a debit, payment, redemption, Invoice, Project or fanout. New OFF Coupon use refuses before economics; ordinary no-Coupon commerce retains its existing authority.
- Publication, request and parent locks recheck exact current authority. Platform Admin never grants business membership. Restrictive RLS and actual-parent notifications compose with predecessor scope rather than replacing it.
- **KI-153 refund semantics remain unchanged:** refund ledger entries do not prove returned wallet/provider money; pending completion/reconciliation and pending-refund headroom reservation remain separate unresolved policy work. No payouts/provider settlement or financial-history rewrite occurred.

## 6. Fresh regression results

All combined runtime results below are this integration writer's new executions, not isolated feature totals or independent reviewer reruns.

| Gate | Final result |
| --- | --- |
| Clean source installation | **156 migrations PASS**; zero Auth users before tests |
| Full pgTAP | **126 files / 5,907 assertions PASS**, native exit0 on final fresh database |
| Forms identifiable focused suite136 | **1 file /80 assertions PASS** |
| Coupons identifiable focused suite137 | **1 file /78 assertions PASS**, including15 combined assertions |
| Full Vitest | **236 files /3,043 tests PASS**, one worker, native exit0 |
| Independent application focused tests | **1 file /4 action tests PASS**, executed by application reviewer |
| TypeScript / generated routes | PASS; final normal route imports restored by `next typegen` |
| Zero-warning ESLint | PASS, native exit0 with `--max-warnings=0` |
| Optimized production build | PASS, native exit0; local build only |
| SQL lint | `public,private`: **zero error entries PASS** on final fresh database; extension scope is not claimed repaired |
| Secret scan | Zero findings across final tracked/staged inventory; private environment/evidence excluded |
| Dependency audit | Zero high/critical; existing **one moderate** music-metadata issue remains KI-155 |
| Diff/inventory | PASS; machine-local config excluded, accepted source preserved |

Complete suites cover the six predecessors, Tenant/Company/role/RLS/RPC isolation, issued money/fulfillment obligations, stale revisions, direct publication/trusted writes, Forms replay/history and Subscription/Coupon duration/sequence invariants. Combined suite137 additionally publishes both Forms/Coupons OFF, preserves Forms history authority, denies management/PA-only membership, retains dependencies, replays original Store/wallet receipts and proves unchanged financial/fanout hashes.

## 7. Genuine concurrency and rollback mutants

- **14 Forms two-session publication races**: both lock orders for create/draft/publish/assign/Contact submit/correction/trusted root; observed blocked waiters and safe commit/refusal. Higher isolation refused.
- **11 Coupons two-session races**: root/rule/Store/wallet versus publication in both orders, post-wait authority loss, two Company members competing for one redemption and identical same-ID purchase. Winners committed, losers refused without monetary duplicates; exact replay reused its receipt. Higher isolation refused separately.
- **12 committed authority-revocation races**: four Forms cases, Coupon update/archive/request-key cases, Subscription terms, Store/wallet permission cases, publication writer/direct-trigger Platform Admin cases. Actual waiters were observed. The five new Coupon/terms/financial reproductions succeeded before correction and refuse afterward; source and post-fix cases cover the other waits. Revoked fixture permissions were restored, with publication grant changes using legitimate immutable revoke/regrant history.
- **22 rollback-only mutants detected/restored**:17 Forms controls and five Coupon controls. Each removal caused concrete test failure; native error artifacts are preserved where later dependent statements aborted. Post-rollback fingerprints checked bodies/ACL/configuration/triggers/policies as applicable and retained Forms rows. Fresh/final source parity verifies restoration. No mutant was committed to the installed application.

These are real independent PostgreSQL sessions, not serial mock calls. Safe abort/deadlock and offline-delivery limits remain; uninterrupted liveness is not claimed.

## 8. Authenticated browser and financial acceptance

Browser plugin unavailable; installed Playwright1.62.1/Chrome was the recorded fallback. App `http://127.0.0.1:3014`, isolated API `http://127.0.0.1:59321`. Normal password logins established genuine synthetic sessions on local development; those same valid sessions exercised the optimized build. Quick Access remained OFF, with no browser service credential or authorization bypass.

**Forms:96 main cases +14 Company/PA-only cases +1 Project ownership-loss case PASS. Coupons:58 combined cases PASS.** All required CSS widths **320,360,390,430,768,1280,1440** were exercised. Main cases cover internal/client/public Forms ON/OFF/re-enable, frozen assignments, receipt history and scope loss. Coupon cases cover editor/radio controls, opened mobile filter, Subscription editor, live denial, denied staff management, saved client Invoice and exact terms carry-forward while both modules are OFF. Long Service content, document width and reachable sticky actions were checked. Enter/Escape/focus-return and native radio keyboard interaction passed; Coupon contexts emulated reduced motion. Recorded page errors were zero in final matrices. Representative screenshots were visually inspected.

Saved money proof: $10.00 subtotal, $1.00 saved discount, $9.00 paid Invoice and $0.00 balance. Owner browser submitted unchanged terms while both Forms/Coupons were OFF; new plan version2 preserved Coupon ID, forever duration, quantity1, unit1000 cents, discount100 cents and currency/tax state. The original Invoice/plan stayed unchanged. Two exact accepted Store replays returned the same900-cent receipt, with wallet, transactions and redemptions byte-for-byte unchanged. Direct OFF quote/use denials and saved cycle/replay rules are separately covered by suite137.

Preserved failed evidence: first pgTAP run had only a new test comparing a post-write result with its pre-write statement snapshot; corrected assertion and final fresh run passed. First Vitest run found the old Forms-only guidance expectation; the full final run passed. The initial Forms guest browser submit hit statement timeout during heavy concurrent validation; serial optimized-build rerun passed. Coupon harness attempts exposed wrong accessible names, an early streamed-DOM read and a QA snapshot-column typo; these harness defects were corrected, without application changes. Project scope verification distinguishes rendered text from hidden cached/RSC text. A normal login attempt on the optimized local build timed out; legitimate dev password sessions were used for optimized authenticated QA as in predecessor acceptance. Hosted/provider-backed Production login was not verified or weakened.

## 9. Independent reviewer evidence

Three actual native same-model read-only agents reviewed the combined source:

| Reviewer | Final result and provenance |
| --- | --- |
| `/root/financial_review` | **PASS**. Found inherited terms stale management authority; final237 preserves original bodies/order and adds only current capability/Company checks. Saved economics, replay and KI-153 remain intact. No DB/browser execution. |
| `/root/security_review` | **PASS**. Found Coupon request/row-wait and publication post-wait authority gaps; verified composition, restrictive policies/private privileges and final eight replacements. No remaining confirmed HIGH/BLOCKER within reviewed delta. No mutations/runtime execution. |
| `/root/application_review` | **PASS** for polling correction; independently executed4 action tests. Found transient permission-read error being converted to denial; final explicit permission observation preserves transport-versus-denial distinction. No DB/browser execution. |

All three also caught the temporary publication `FOUND` contract regression, corrected before final acceptance and covered by two missing-Tenant tests. Reviewers inspected source independently; primary runtime totals are not independent reviewer execution. No external cross-model review is claimed.

## 10. Remaining issues, Services recommendation and memory proposal

No confirmed unresolved integration BLOCKER/HIGH remains. Retained risks: KI-116 global Coupon namespace direction; Forms version-pin strand; KI-149/local optimized-build normal-login verification limit; KI-152 private upload reconciliation; **KI-153** pending/refund financial limitations; KI-154 unscoped extension lint; **KI-155 moderate dependency DoS**; KI-156 older public-type drift. The prior Coupon handoff's nonblocking portal-drawer Escape issue is historical baseline evidence, not newly repaired. Previously delivered offline/cached content cannot be recalled; stale navigation links may persist until shell refresh while authoritative RPCs deny access.

Services should start only under a new explicit instruction from **`bde6ae40038049b00399dca6e26f838ad2948efe` plus this documentation delivery**, using a separately guarded isolated environment and this complete composed chain. Preserve reservation discipline, obligations/receipt redaction and all F/C policies. Do not start from the older audit worktree or a moving main baseline. No Services implementation was performed.

Exact proposed note targets/content are in [forms-coupons-proposed-memory-20261012.md](forms-coupons-proposed-memory-20261012.md). No canonical notes, Raw files, `.ai-memory`, Global OS or Skills Index were written. No main merge, push, Production publishing, hosted Supabase change, tool/plugin installation or execution-policy change occurred.

Private evidence root: `%LOCALAPPDATA%/Temp/wl240-integration-20261012`. Key receipts: `fresh-final-proof.json`, `fresh-final-replay.log`, `definition-acl-parity-proof.json`, `pgtap-wf240_final_20261012.log`, focused Forms/Coupons logs, `vitest-final.log`, `checks-final.log`, `build.log`, `sql-lint.log`, `secrets.log`, `dependency-audit.json`, `concurrency-results.json`, `coupon-races.json`, `coupon-races-more.json`, authority before/after/supplement receipts, both mutant receipts, `browser-results.json`, `browser-scope-supplement-results.json`, `browser-project-scope-results.json`, `browser-coupons-results.json`, `coupon-financial-before.json` and `coupon-financial-after.json`. This directory also contains private credentials/session state and must not be committed, copied wholesale or treated as a second memory tree.

**STOP after local combined acceptance.** Final delivery leaves the integration branch separate, its verified database/artifacts intact, app stopped and the original machine-local Supabase config modification unstaged.
