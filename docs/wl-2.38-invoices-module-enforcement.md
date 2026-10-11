# WL-2.38 Invoices published-module enforcement

**RESULT: PASS locally, with documented follow-ups.** Acceptance completed 2026-10-11 by Codex. No push, merge, hosted write or deployment.

## Checkpoint

Branch: `feat/white-label-tenant-foundation-20261007`. Starting HEAD verified `99f1b936924b7e3e2b5367c0f3e4de31de49ff1d`. Resumed the preserved 25 tracked modifications and eight untracked files; necessary UI/tests were added without discarding that work. The focused delivery commit contains this report; its final hash is recorded in canonical Current State and the final clipboard handoff.

Global OS, reconstructed Skills Index and canonical project/security memory were read successfully before resuming under the user's explicit authorization. Earlier missing-path blockers are resolved. AntiSlop DURING remained active. Relevant installed Ponytail, AntiSlop UI/mobile/human, Impeccable, security, Supabase, React and frontend-testing guidance was applied. Caveman Commit supplied message conventions only. No skills/plugins were installed.

Migration `20261010222032_invoices_module_enforcement.sql` was already installed transactionally at the preserved checkpoint. It was **not reapplied**. Fresh readback verified all 31 function bodies, 442 pre-existing ACLs, five restrictive history policies, four trusted-write triggers and revoked direct item Project-pointer SELECT. After acceptance, `supabase migration repair 20261010222032 --status applied --local` registered the existing installation. Subsequent registry/body/ACL readback passed. Production is unchanged.

## Startup synchronization and provenance

Configured Global OS: `C:\Users\TrojanNiAnton\Downloads\Anthony OS-20261009T175758Z-1-001\Anthony OS\10 Templates\Coding Agent OS\CODING AGENT OPERATING SYSTEM.md`.
Skills Index: the same vault's `10 Templates\Coding Agent OS\SKILLS\00 Skills Index.md`.
Canonical project memory: the same vault's `02 Projects\Wolf Forge Platform\AI Memory`; sibling Security notes were also read. Relevant Current State, Decisions, Architecture, Security, QA, Known Issues and Implementation Log evidence was inspected. Repository and executable database evidence took precedence over historical QA claims.

WL-2.39 was committed at the expected baseline and locally installed. Its function readback was checked before implementing this milestone. The requested four reports were read. Preserve these authorship distinctions:

- `wl238-invoices-lifecycle-audit-claude.md` was authored by **Codex**, despite its filename.
- Its `-claude-review.md` companion was authored by **Claude Code**.
- The current Subscriptions lifecycle audit contains a Claude review and an earlier Codex report preserved as an appendix.
- `wl239-independent-final-review-claude.md` from this session was authored by **Codex**, despite its filename. It reported PASS WITH FOLLOW-UPS, retaining financial and evidence limitations.


## Implemented policy and financial boundaries

The published registry now has **six optional modules**: Reporting, Investment Intent, Projects, Tickets, Subscriptions and Invoices. **Three remain mandatory**: Services, Forms and Coupons. Operations remains excluded. Existing draft selections, revision immutability and no-publication compatibility are preserved.

Subscriptions ON still requires both Services and Invoices. Disabling Invoices requires Subscriptions OFF; existing uncanceled subscription blockers remain intact. No subscription cancellation, publication seed or automatic publication was introduced. See migration `private.published_module_set_valid` and publication calls at lines 209 and 271.

`private.require_invoice_publication_clear` (migration line 14) rejects unpaid/payment_pending Invoices, unpaid collectible balances, archived unresolved obligations and pending payment/refund operations at both publication boundaries after Tenant coordination. Successful refund entries do not make a paid Invoice collectible again. Refusal does not settle, write off, archive or rewrite financial records.

Latest local pending payment/refund counts are **0/0**. Five pre-existing unpaid synthetic QA Invoices were left intact. Their obligations legitimately prevent affected Tenants from publishing OFF. No new pending-completion workflow exists; if an actual pending record blocks publication without a legitimate existing resolution, stop for the separately required product/security decision.

`private.invoice_record_visible` (line 35) and `private.can_read_invoice` preserve current Tenant, Company, role, account class and archive restrictions. OFF history requires an issued, non-draft eligible record. Restrictive policies also constrain child payment/refund/item/activity reads. Notifications resolve authoritative financial parents, including legacy NULL-Tenant subjects, for lists and mark operations. Dashboard historical finance is explicitly constrained while retaining existing dashboard authorization.

Receipt item reads use record-aware RPCs. Currently inaccessible Project pointers become NULL; direct authenticated `invoice_items.order_id` access is removed. Store receipt replay similarly redacts Project ID/number and does not reveal a Ticket reference. Repository callers use the replacement RPCs. Authenticated rendered receipts, read-only behavior and stale-cache redaction were verified on 2026-10-11.

Wallet balance access no longer depends on the published `portal_invoices` lifecycle. Current client identity, Company authority, `invoices.view` and private-company permissions remain required. The new `app_list_my_wallet_history` (line 120) is current-client/current-Company scoped and returns limited monetary history without Project pointers. Independent authorized wallet adjustments remain available and tested. No OFF blocker was added for nonzero wallet balances. Wallet history UI is implemented and authenticated browser-tested.

NEW creation, editing, issuance, voiding, payment, refund, wallet payment and Store purchase encounter a Tenant-serialized Invoice write gate. Trusted Invoice/items/payment/refund mutations are also guarded by four write triggers; existing direct-write permissions were not broadened. Subscription issuance/generation cannot bypass the Invoice boundary. Platform Admin status does not replace Tenant business authorization.

Previously accepted create/payment/refund/wallet/Store requests retain database-backed exact replay, subject to current actor, operation, payload, Tenant, Company, capability and record visibility. Changed payloads and inaccessible records refuse. Create replay does not expose a draft while OFF. Capability checks are repeated after Tenant-lock waits. Payment/refund application prechecks that rejected legitimate settled exact retries were removed; the authoritative RPC now decides replay versus new execution. The five focused action tests demonstrate the defect before and the corrected behavior after.

Store denial is before coupon use, wallet debit, Invoice/payment/Project/conversation creation, quota use, interest cleanup and fanout. Database assertions compare state before/after refusal and replay. Ordinary ON purchases remain available without adding `invoices.manage` or `projects.create` requirements to buyers. Catalog/cart behavior and normal authenticated ON purchases were verified.

**Refund limitation preserved:** a refund records ledger evidence; it does not automatically return funds to a wallet or provider. No wallet refund credit, provider transfer or pending reconciliation system was implemented. A successful refund ledger row is not proof of returned money. **KI-153 remains open**, including the established unresolved financial limitations. **KI-154 remains open** for pre-existing unscoped pgTAP-extension lint errors; it does not excuse application SQL errors.

## Earlier local security and concurrency evidence (2026-10-10)

Evidence directory: `%TEMP%\wl238-enforcement-qa`. These are primary-writer results, not independent reviewer executions. Synthetic fixtures were isolated; no real customer payments or shared database reset were used. A dedicated new synthetic race Tenant retains inert drafts/settled test finance. Pre-existing business records were not repaired or deleted.

- Twelve genuine two-session financial/publication orderings cover create, issue, payment, refund, wallet payment and Store purchase in both orders. OFF-first refuses new work where OFF can legitimately publish. For payment/wallet payment, the existing unpaid parent blocks publication, so subsequent payment occurs while ON; this is not an OFF-payment success.
- Repeatable Read and Serializable stale-publication cases fail closed.
- Trusted pending-write-first makes publication wait; that test rolls back the pending insert before publication proceeds. It does **not** prove committed pending-write-first rejection. OFF-first commits and the trusted pending insert then refuses.
- Privileged Invoice-first/Tenant-first lock inversion aborts a participant; both sessions roll back with exact snapshot restoration. This establishes safe abort, not impossibility of deadlocks or uninterrupted liveness. Retry the whole transaction with fresh authorization.
- Two separate permission-revocation waits cover new payment and accepted payment replay. Both refuse after capability revocation during the Tenant wait, with no new payment row. Other per-operation revocation cases are source-reviewed rather than individually raced.
- Fifteen distinct serial rollback-only mutants are detected and exact snapshot restoration is recorded for each: Invoice gate, dependency, archived obligation, pending payment, pending refund, history scope, financial role permission, draft disclosure, replay visibility, trusted writes, wallet lifecycle separation, wallet Company isolation, Project receipt disclosure, duplicate-payment replay and client Store-OFF bypass.
- A separate lock-removal mutant is detected by an independent NOWAIT Tenant-lock probe, then restored. Mutation snapshots include function definitions/ACLs, policies, triggers, column grants, publications and synthetic/business state. No simultaneous mutation writers ran.

Artifacts: `race-results.json`, `race-extra-results.json`, `authorization-race-results.json`, `mutations.json`, `coordination-mutation.json`, `winning-functions-current.json` and corresponding harnesses/logs. Retain them as historical backend evidence; they reside in temporary storage, not durable canonical memory.


## Fresh acceptance results (2026-10-11)

| Gate | Verified result |
|---|---|
| Full Vitest | 232 files, 3,020/3,020 PASS; native exit 0 |
| Full pgTAP | 124 files, 5,764/5,764 PASS; native exit 0; includes Invoices 93 and Subscriptions 125 assertions |
| TypeScript / ESLint | PASS / zero warnings |
| Production build | PASS locally, native exit 0; Sentry upload credentials removed, no deployment |
| Application SQL lint | public/private zero errors; native exit 0 |
| Secret scans | Tracked 1,644 and inclusive tracked/untracked 1,654 source files: zero findings before staging; final staged tracked scan: 1,654 files, zero findings |
| Diff check | PASS; line-ending notices only |
| SQL and migration registry | 31/31 bodies, 442 previous ACLs unchanged; registration present as applied locally |
| Added public RPC types | All four match fresh local generation structurally |
| Browser QA | Normal authenticated HTTPS sessions; all seven required widths, zero uncaught page errors in successful final runs |
| Reviewer C | Native Codex read-only source review PASS; independent focused 42/42 Vitest PASS |

An initial fresh full pgTAP failed suite 043 because its three audit assertions included a genuine unrelated authorization-denial event created during browser QA. The assertions now target their retained synthetic actor; count, FK SET NULL and append-only checks remain intact. Focused 38/38 and the subsequent full 5,764 pass; no audit records were deleted/reset. Reviewer C approved this isolation correction.

An initial fresh whole-file type-generation comparison found older public schema drift (e.g. activity/client-contact Tenant fields already absent at starting HEAD). WL-2.38's four new RPC contracts match the local generator; unrelated type rewriting is deferred as KI-156. The unchanged dependency audit reports one moderate `music-metadata@11.15.0` DoS finding in Team voice inspection, KI-155. No high/critical dependency finding was reported; no forced upgrade was made.

## Authenticated application/browser acceptance

Existing normal-login Owner, staff, Client and foreign Company sessions were used on an isolated new synthetic Tenant/Company; Platform Admin and foreign Tenant also authenticated through normal login. No Quick Access session substitutes for acceptance. Installed Playwright/Chrome was used because the Browser plugin/skill is absent. HTTPS renewed a temporary expired local certificate with existing OpenSSL; no trust-store/security-policy change or tool installation. Builder QA opened its existing development-only loopback flag for a preauthenticated Platform Admin; the page still rejects Quick Access and requires the real entitlement. Tenant business authorization was not bypassed.

- Internal/client Invoice list/detail, new/edit, wallet, Store and dashboard surfaces were exercised at 320, 360, 390, 430, 768, 1280 and 1440px; opened payment selects, filters and builder also passed overflow checks. Selected screenshots were inspected visually.
- Refund/payment dialogs, custom payment select and filter sheet passed keyboard open/navigation, nested Escape dismissal and focus return. Reduced-motion behavior was checked. New wallet/refund copy passes computed WCAG contrast using unrounded ratios and actual large-text thresholds. This is targeted browser QA, not a whole-product accessibility certification or physical-device test.
- Owner created/edited/issued a custom Invoice through the UI with authoritative readback. Unsaved form text survived an unrelated financial update. Client wallet payment and manual bank-transfer ledger payment settled the intended synthetic Invoices. Refund UI recorded a ledger entry with **no wallet credit**. Receipt Print invoked browser print; no external PDF/payment service.
- Staff manage-only revocation removed creation controls while retaining authorized history. Foreign Company/Tenant cannot resolve the protected Invoice. Platform Admin without Tenant business membership receives no Invoice access. Draft/new/edit guards refuse correctly while OFF; neutral denial handles both NOT_FOUND and PERMISSION_DENIED.
- OFF publication refreshed stale wallet/new/list/Store tabs and removed new-work controls; authorized issued/refunded history, printable receipt, wallet history/balance and catalog remained. Re-enable restored authorized creation and Store offers. Final rerun after the visibility-state fix covered all seven OFF widths and guards. Unrelated business-state snapshots remained unchanged in that run.
- Browser purchase exposed an accepted-result loss caused by keys tied to wallet balance. Authority signatures now exclude ordinary money/status/addition updates while retaining actor/Tenant-or-Company, module, capability, membership/currency restrictions. Current target/removal or typed denial still clears protected content. Fresh data refresh preserves mutation state.
- PurchaseWithBalance snapshots its decision offer so its pending/accepted result survives a refreshed insufficient balance. Uncertain transport retry retains the same request ID. Focused tests cover sufficient/insufficient post-debit states and same-ID retry. A fresh explicit browser decision retained its confirmation through wallet refresh and navigated to Projects; readback found one debit, paid Invoice and Project. The previously accepted decision was reconciled, never blindly retried. Both synthetic Projects were completed through the existing authorized Owner RPC. No real finance was repaired or reset.

Evidence in `%TEMP%/wl238-enforcement-qa`: `browser-resume-results.json`, `browser-extra-results.json`, `browser-authority-final.log`, `browser-extra-final.log`, `browser-extra-admin-final-2.log`, `browser-foreign-final.log`, `vitest-final-verified.log`/exit JSON, `pgtap-final-verified.log`/exit file, `build-final.log`/exit file, `db-lint-accepted.log`, `final-sql-before-registration.json`, `final-sql-after-registration.json`, `migration-registration.log`, `invoice-rpc-types-readback.json` and individual PNGs. Temporary session/credential/certificate files are private scratch data, excluded from Git and handoff delivery. Do not export the artifact directory wholesale. Historical concurrency/mutant results above were not presented as new executions after UI changes; SQL equality was freshly reverified.

## Independent reviews

Earlier reviewers A/B were native Codex read-only source reviews, not Claude or independent runtime certification:

- Reviewer A, `/root/invoice_db_review`: financial authorization/database concurrency. Re-review found no unresolved concrete BLOCKER/HIGH/MEDIUM in the database slice. The primary identified and corrected pre-lock capability timing after the initial review; the reviewer acknowledged missing it initially and inspected the post-lock fix and permission-race evidence. Reviewed migration SHA256: `495641F7C765D04434689CBF61A55609B36B04C393549CB783CE8BAC4D00A78D`.
- Reviewer B, `/root/invoice_financial_review`: payment integrity, wallet/history, refund/replay and obligations. Found no confirmed BLOCKER/HIGH in the reviewed financial/database revision. Explicitly excluded UI/browser, executable equality and independently executed restoration. Its initial artifact inspection covered fourteen mutations. Its subsequent read-only follow-up confirmed all fifteen distinct outcomes as detected/restored, including role-permission assertions 79–81. Updated mutation artifact SHA256: `DF795428EA378A8817FABAB868D8CF76BB7B639E8CA5B39FF9DDBF10205298DE`. This clears the missing-artifact caveat without claiming independent runtime execution.

- Reviewer C, `/root/reviewer_c`: final whole application-source and reconciliation reviews PASS with no unresolved confirmed BLOCKER/HIGH/MEDIUM in WL-2.38. Independently executed the three-file 42/42 focused suite; reviewed the final suite-043 isolation correction as source only. Full-suite/browser/SQL evidence remains primary-writer provenance. Reviewer C made no source, database, memory or Git writes.

## Canonical memory and handoff

After verified acceptance, narrowly updated existing Current State and appended Implementation Log, settled D-305, Known Issues and Architecture evidence; existing Security overview/topics/registry/change log record SEC-051 and follow-ups. Exact disk readback and preservation of unrelated content are required before the focused local commit. No new memory tree, Raw write, automatic sync or Global OS edit.

KI-153 remains open for pending completion/reservation/reconciliation and the distinction between refund ledger and returned funds. Its accepted replay/precheck and Invoice published wallet-lifecycle defects are corrected within this scope. KI-154 remains open for unscoped pgTAP-extension lint; scoped application lint passes. KI-155 dependency DoS and KI-156 older generated public-type drift require separately authorized follow-up. Privileged row-first deadlock safe abort, offline/already-delivered information and unverified hosted/provider behavior remain limitations.

**STOP after WL-2.38.** The next action requires a new explicit user instruction. Forms, Services, Coupons, dependency/type cleanup, push, merge and hosted/Production deployment were not undertaken.
