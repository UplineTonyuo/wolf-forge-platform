# Forms integration acceptance — 2026-10-12

Status: **PASS — local isolated Forms integration accepted**. Canonical Second Brain remains read-only.

## Source and authority

Worktree: `C:\Users\TrojanNiAnton\Documents\Wolf-Forge-White-Label-Integration`.
Branch: `integrate/forms-enforcement-20261012`.
Accepted starting baseline: `adad483cb23e3fc8c98c399ee2034f8b45ad1017`.
Exact Forms source: `87f893744f61c66a0854fb21ba6f19da7c5c7356`, whose parent is that baseline.
Integration cherry-pick: `24ed9c8b89a2753c34364c1605834cd12512ac2e` with source provenance in its message. Its committed tree exactly matched the completed Forms tree; no second cherry-pick or branch merge occurred.
Verified correction/integration commit: **`f2e7ae2dc0f0c0aa585023fb0e66d91502b7c0cd`**. Its exact diff has 10 files, 1,501 insertions and 7 deletions. The subsequent documentation delivery commit contains this handoff and proposed memory only; its final HEAD is supplied in the delivery report. `git show f2e7ae2dc0f0c0aa585023fb0e66d91502b7c0cd` reconstructs the exact correction diff. The branch does not contain Coupons233.

The original 37-file commit contained intended Forms/application/tests/handoff changes, suite 136 and migration `20261011172232_forms_module_enforcement.sql`. Local Supabase configuration and credentials were excluded. Required code was committed, not silently imported from the feature worktree. Original Forms acceptance totals are historical evidence only.

Configured Global OS, canonical Skills Index, project Brain/Current State/Decisions/Known Issues/Architecture and Security overview/threat model were read. Active Worktree Protection, parallel setup integration controls, cross-module report, Forms handoff/proposed memory, and WL-2.38/WL-2.39 evidence governed this work. The sole integration writer used three native read-only reviewers. No overlapping integration writer was started.

## Non-destructive infrastructure recovery

Project: `Wolf-Forge-Forms-Integration-20261012`.
System identifier: **7695548610956316710**.
Database container ID: `f342df9ed2eca359ef61399c7ec599435b41d683ae57b65908e426695e7ea505`.
Database container and volume: `supabase_db_Wolf-Forge-Forms-Integration-20261012`.
Network: `supabase_network_Wolf-Forge-Forms-Integration-20261012`.
Database mount: `/var/lib/docker/volumes/supabase_db_Wolf-Forge-Forms-Integration-20261012/_data` → `/var/lib/postgresql/data`.
Ports: API 59321, DB 59322, shadow 59320, Studio 59323, mail 59324, analytics reservation 59327, pooler reservation 59329, edge 8583, app 3014. Optional disabled services are not failed required services.

Initial startup health retries expired while Storage was still starting; logs showed subsequent healthy startup rather than a database corruption failure. Diagnostic startup retained the new integration resources for inspection; all required services then became healthy and a normal startup succeeded. No manual volume deletion, reset or protected-project repair occurred. Earlier CLI failed-start cleanup of its newly created integration resources is preserved in logs. The pre-existing edge volume was retained. Conflicting Builder ports were identified and avoided before provisioning.

Isolation is proven by project/container/network/mount/volume identity and guarded connection targets, not ports alone. Protected canonical, Forms, Coupons and Builder containers have distinct IDs/networks/storage in the Docker metadata inventory. Renewed recovery did not connect to their databases. Local environment secrets and backups remain private scratch artifacts, never committed.

## Migration registration and executable proof

The primary `postgres` database has **153 registered migrations**, latest `20261011172235`. Original Forms migration 232 remains unchanged. Corrections are forward migrations:

- `20261011172234_forms_integration_authorization.sql`: fresh authority checks after waits, scoped historical projections and safe direct-column grants, collection read policy and current submitter checks.
- `20261011172235_forms_collection_policy.sql`: narrow authenticated policy wrapper and preservation of the original unpublished trusted-bootstrap exception.

Installed normalized bodies match **30** latest source definitions exactly. Readback verifies **10** Forms guard triggers, **5** restrictive definition policies, restricted raw Project/provenance columns, narrow wrapper EXECUTE and no broad Tenant helper EXECUTE. All **56** inventoried baseline signature ACL/config/security-definer properties remain preserved.

An additional database, `wf_forms_acceptance_20261012`, lives inside the same verified integration cluster. It was bootstrapped with native Supabase schemas and then freshly replayed **all 153 application migrations from source in order**, including 232/234/235; it is not a final application-schema clone. Readback found 153 registrations, zero Auth users and the expected 59 seeded Services before pgTAP. An initial native restore role error was inspected and resumed using the native schema owner; no existing database was reset or destroyed. The primary database and its synthetic test records were preserved.

## Confirmed findings and resolutions

| Finding | Resolution and evidence |
|---|---|
| Forms authority could become stale after a Tenant/request lock wait | Management, draft and submission paths recheck current authority after relevant waits. A valid pre-fix synthetic request accepted revoked authority; post-fix management/client requests were refused. Four independent Tenant-wait revocations also refused writes with unchanged effects. |
| Direct table reads exposed historical Project pointers/provenance | Preserve RLS and safe historical columns; revoke raw sensitive columns, use secured submission-list RPC and masked RPC return composites. Tenant/Company and current Project/Ticket scope govern disclosure. |
| Forms OFF permitted collection-definition reads | Five restrictive policies now conjunct original RLS with a narrow current-Tenant Forms check. Historical receipt access remains under the approved current authorization scope. Broad privileged helper access was not granted. |
| Initial correction narrowed trusted bootstrap behavior | Migration 235 preserves the established NULL-auth, unpublished bootstrap exception while published/authenticated writes retain guards. Full fresh replay and regressions passed. |
| Builder guidance still treated Forms as mandatory | Guidance names seven optional modules, preserves Services/Coupons requirements and financial publication obligations, and explains Forms freeze/history/re-enable. |
| Stale Project/candidate scope could survive unchanged capability flags | Visibility signature includes current masked Project/Ticket pointers and eligible assignment options. Browser ownership-loss check removed the rendered title while capabilities stayed unchanged; SQL denied access/pointers. |

No confirmed unresolved BLOCKER/HIGH remains in the completed reviews. Existing documented financial/dependency/type-drift limitations are not claimed repaired by this milestone.

## Fresh acceptance evidence

All runtime evidence below was executed by the primary integration writer against the isolated branch/environment, not inferred from reviewer prose.

| Gate | Result |
|---|---|
| Focused Forms pgTAP | Separate final focused run: **1 file / 80 assertions PASS**; six additional boundary assertions retained |
| Full pgTAP | **125 files / 5,834 assertions PASS**, fresh ordered source replay |
| Focused application checks | Stripe boundary 23/23 PASS unchanged; final Forms integration/builder **2 files / 24 tests PASS**; earlier Forms coverage 55/55 and native application 79/79 |
| Full Vitest | **234 files / 3,034 tests PASS**, final source, single worker |
| TypeScript | Final post-build route-type generation check PASS |
| ESLint | PASS, zero warnings permitted |
| SQL lint | public/private: zero error entries, PASS |
| Production build | PASS, verified native exit 0; local optimized build only, no deployment |
| Publication races | **14** genuine two-session cases, both lock orders across seven writers; observed waits and correct refusal/serialization; Repeatable Read refusal |
| Authority races | **4** committed Tenant-wait authority revocations, plus management/client request-lock revocation checks: refused, no surviving business effects |
| Rollback mutants | **17/17 detected**, exact post-rollback definition/ACL/config/trigger/record restoration readback |
| Browser | **96 main cases + 14 Company/PA-only cases + 1 unchanged-capabilities Project ownership-loss check PASS** |
| Responsive/authentication | 320, 360, 390, 430, 768, 1280, 1440px; genuine normal password sessions, no Quick Access bypass |
| Final secret/diff scan | **0 findings across 1,669 tracked files**, including staged new source/docs; staged diff check PASS |

Browser main acceptance exercised internal list/builder, public ON/OFF submission, stale screens, frozen client assignments with exact record preservation, authorized history while OFF, re-enable and persisted client submission, foreign Tenant denial, controls/focus/Escape/reduced motion. Additional Company changes and PA-only loss denied the old receipts at all seven widths. Synthetic Company/membership/permission/assignee fixtures were restored by readback after scope experiments.

Normal password login established sessions on the local development server. The full matrix used those valid sessions on the local optimized build; provider-backed Production login itself was not tested. A fresh normal staff login preceded the final Project check on the development server. No service credentials were installed as browser authentication. Browser plugin was unavailable; existing Playwright/Chrome was the documented fallback.

Failures remain in evidence: the original Stripe source-walk timed out at its unchanged 5s limit; focused rerun and full rerun passed. Early dirty-primary pgTAP runs had global-fixture contamination and an initially ungranted policy helper; the narrow wrapper and fresh source-replay database resolved those causes without weakening assertions. Auth had one transient 504; unchanged normal-login retry passed. Next dev restarted at its memory threshold; the main matrix moved to the local optimized build. A transient client success heading was replaced in QA with the persisted final receipt heading plus completed database status. Project QA initially used hidden body text including stale RSC payload; rendered text and database scope were verified instead. No failed artifact is labeled a pass.

## Independent reviewer provenance

Three genuine native, same-model, read-only agents: `/root/reviewer_a` (database authorization), `/root/reviewer_b` (cross-module compatibility), `/root/reviewer_c` (application acceptance). They reported source findings which only the primary writer corrected. Final reconciliation found no residual confirmed source HIGH/BLOCKER. Reviewer C independently ran 79 application tests earlier; its final reconciliation was source-only. Database/browser/mutation/concurrency totals above are primary execution evidence reviewed by agents, not independent reruns. No cross-model review is claimed.

## Coupons readiness — no integration performed

Original Coupons lifecycle audit and the accepted shared-function inventory were inspected. Unstable uncommitted Coupons work was not treated as a finished artifact. Coupons retains reservation `20261011172233_coupons_module_enforcement.sql`, suite 137.

| Collision boundary | Exact items to compare when Coupons reports PASS | Required preservation |
|---|---|---|
| Publication and conjunction | `private.published_module_set_valid(text[])`, `private.validate_tenant_module_publication()`, `private.publish_tenant_modules(uuid,integer,text[],text)`, `public.app_require_module_access(text)`, `private.profile_has_permission_in_tenant(uuid,uuid,text)` | Forms optionality, six accepted module gates, explicit permissions and current Tenant locks; Invoice obligations |
| Shared lock/write roots | `private.lock_tenant_module_lifecycle(uuid)`, `public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb)`, `private.create_ticket_from_contact_submission(uuid)`, `private.replace_form_draft(uuid,uuid,jsonb,uuid)` | Fresh authority, Forms-only Contact with Tickets OFF, trusted exception limits, pointer redaction and replay confidentiality |
| Coupon and financial writers | `private.calculate_coupon(text,jsonb,numeric,uuid,uuid,boolean)`, `private.prepare_coupon_redemption()`, `public.app_validate_coupon(text,jsonb,numeric)`, `public.app_quote_invoice_coupon(uuid,text)`, `public.app_quote_store_coupon(uuid,text)`, `public.app_purchase_service_with_balance(uuid,uuid,text)`, `public.app_pay_invoice_with_wallet(uuid,uuid,text)`, `public.app_create_invoice(uuid,jsonb)`, `public.app_update_invoice(uuid,jsonb)`, `public.app_update_subscription_terms(uuid,uuid,jsonb)`, `private.insert_subscription_plan_items(uuid,jsonb)` | No fresh redemption/quote/plan attachment while OFF; saved issued financial facts and immutable subscription terms; no repricing or new financial effects on replay |
| Historical financial surfaces | Invoice visibility/notification helpers, `app_list_my_notifications(integer)`, dashboard/wallet projections and cycle issuance functions in setup inventory | Tenant/Company scope, historical obligation visibility and previous financial side-effect isolation |
| Shared application/tests | `src/domain/white-label/preview.ts`, `src/lib/supabase/database.types.ts`, Forms visibility/repository, suite 136, planned 137, module/publication/builder and financial regression tests | Compose guidance/types instead of replacing Forms corrections; keep seven-width/authenticated regression coverage |
| Migration ordering | 232 Forms → 233 Coupons → 234/235 Forms integration corrections | Compare full signatures and final definitions. 234/235 can overwrite a shared 233 replacement during fresh replay. Use an explicit forward composition successor after 235 where needed; verify upgrade and fresh-replay parity. Never renumber an applied migration blindly. |

Before any later Coupons integration: verify exact clean committed artifact/base/acceptance, review source-only diff and policy implementation; compare every replaced signature against this integrated HEAD and inventory ACL/config/definer; compose conflicts explicitly; replay in its own authorized isolated environment; run Forms/financial/Coupons regressions, real races, rollback mutants and authenticated UI; require no HIGH/BLOCKER; record final installed-source parity. The original audit recommendations are historical; existing C1–C5 approval recorded by the parallel controls governs the approved policy. This does not authorize starting Coupons integration in this session. No Coupons branch/database or Builder V2 changes were made here.

## Evidence custody and delivery limits

Private evidence root: `%LOCALAPPDATA%\Temp\wl-forms-integration-20261012`. Key files: `identity.json`, `definition-proof.json`, `acl-proof.json`, `fresh-validation-proof.json`, `fresh-replay.log`, `pgtap-wf_forms_acceptance_20261012.log`, `pgtap-wf_forms_acceptance_20261012-forms.log`, `read-scope-final.json`, `authority-after.json`, `client-authority-after.json`, `authority-races-results.json`, `concurrency-results.json`, `mutants-results.json`, `browser-results.json`, `browser-scope-supplement-results.json`, `browser-project-scope-results.json`, `browser-auth-refresh.log`, `vitest-delivery.log`, `vitest-focused-delivery.log`, `build-native-delivery.log`, `build-native-exit.txt`, `eslint-delivery.log`, `typecheck-delivery.log`, `secret-delivery.log`. Preserve the directory; it also contains private credentials, session state and backups and must not be committed or copied wholesale. PowerShell native-stderr diagnostics in some redirected logs are not application test failures; retain the test summary/native exit evidence instead of inferring status from that wrapper noise.

Final runtime reconciliation confirmed the same 30 definitions/153 migrations and 56 privilege properties after all synthetic scope experiments. Only the writer-owned local app process tree was stopped; the integration database, records and artifacts remain available. Final intended Git status is a single unstaged local `supabase/config.toml` modification, excluded from the delivery commits.

Source correction scope is the two forward migrations, suite 136 additions, secured repository/types, guidance and current Forms visibility tokens/tests. Local `supabase/config.toml`, `.env.local`, generated route files and private artifacts are excluded from commits. Canonical memory/Production, main and other feature worktrees were not written by this integration writer. Unrelated pre-existing dirty files elsewhere are not represented as clean. No push, hosted write or merge to main occurred.

Proposed memory delta: [forms-integration-proposed-memory-20261012.md](forms-integration-proposed-memory-20261012.md). Stop after Forms acceptance; Coupons/Services need separate instruction.
