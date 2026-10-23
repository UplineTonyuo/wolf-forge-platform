# WL-2.39 Subscriptions published-module enforcement

Implemented locally from `c0b43e70f5c63e23f5df677a8da4b25df3692f30` on `feat/white-label-tenant-foundation-20261007`. Global OS, canonical memory, the complete Subscriptions audit and both Invoices reports were read before implementation. The Subscriptions audit was authored by Codex despite its Claude filename. Native reviewers below were independent of the primary writer; they were not external Claude reviews.

## Approved behavior

1. Reporting, Investment Intent, Projects, Tickets and Subscriptions are optional published modules. Services, Invoices, Forms and Coupons remain mandatory. Subscriptions requires Services and Invoices; Projects still requires Services and Tickets. Catalog dependency, Operations exclusion, immutable revisions and no-publication compatibility remain. Drafts are independently editable and inert, without silent rewriting.
2. Both publication boundaries refuse Subscriptions OFF while any status is not `canceled`, including archived active, paused, past-due and pending-cancellation plans. Archive is not cancellation; records are never automatically repaired or rewritten. An archived uncanceled plan without an existing authorized resolution remains a safe publication blocker.
3. Authorized canceled history, terms, cycles, events and calendar remain readable while OFF. Existing Company, Tenant, role, account-class and archive restrictions remain. Existing internal assisted cancellation and canceled-parent reconciliation are nongenerative; clients gain no cancellation permission. Re-enabling does not revive canceled plans or skipped cycles.
4. New creation, terms, pause/resume, uncancel, restoration, invoice generation and scheduling/renewal are refused while OFF before business or quota effects. Exact accepted creation/terms/generation requests require current capability, actor/operation/payload binding and parent visibility. Generated-invoice replay also checks current Invoice/Company visibility. Altered requests cannot replay.
5. Independently authorized historical Invoice payment, wallet settlement, refunds, voids and receipts continue. Nested bookkeeping is limited to verified existing canceled Subscription/cycle/Invoice relationships and exact historical transitions. It does not authorize arbitrary new events, plans or cycles. No provider, scheduler, automatic refund or Invoices optionality was implemented.

## Authoritative boundaries

Forward migration `20261010193103_subscriptions_module_enforcement.sql` is applied locally. It replaces 27 functions and adds four scoped functions, seven write triggers and five restrictive SELECT policies. It seeds no publication, draft or business row. All 31 executable bodies match source; all 438 existing function ACLs remain unchanged.

- `private.published_module_set_valid`, `validate_tenant_module_publication` and `publish_tenant_modules` extend the existing validator/writer, with uncanceled obligations checked under the existing Tenant-row lifecycle lock.
- `private.require_subscription_write` and `enforce_subscription_module_write` protect public lifecycle calls and owner/trusted writes to subscriptions, plans/items, cycles, events, payment methods and dunning attempts. Existing API write grants stay revoked; no generic bypass flag is introduced.
- `private.can_read_subscription` permits OFF history only for canceled, currently visible parents. `subscription_history_policy_allows` intersects existing child/activity RLS without broadening enabled/no-publication behavior. All five permission keys remain meaningful: view, manage, billing, pause and cancel. There is no global denial of every subscriptions permission.
- Create/terms/generate replay branches recheck current visibility before returning accepted results. Pause/resume/schedule/remove cancellation/restore coordinate before new work. Cancel/reconcile keep approved nongenerative paths. Due-work listing returns no generative work OFF after its existing billing authority.
- `private.issue_subscription_cycle_invoice`, `schedule_subscription_cycle` and `schedule_next_subscription_cycle` coordinate Tenant, parent and cycle locks. Non-active parents do not renew. Six existing linked-Invoice RPCs coordinate Tenant before Invoice locking while retaining their financial/replay logic.
- Notification list, mark and mark-all use the actual Subscription parent Tenant, including schema-legal legacy NULL-tenant notifications. OFF additionally requires authorized canceled-parent visibility. Unresolvable subjects fail closed without deleting storage. Existing Invoice and other independent notification categories retain their rules.

Internal/client routes, new/terms editors and Calendar use current authoritative visibility. Explicit denial hides protected content; transport failures remain retryable. Status-keyed boundaries refresh stale controls, and generation guards prevent delayed Calendar feeds restoring denied data. OFF opens the canceled-history filter and Clear returns to it independently of management rights. Calendar traps Tab, closes on Escape, restores opener focus and reflows summary metrics on mobile. The existing builder explains current dependencies and obligations; six/three defaults and saved selections are unchanged. The dev-only allowed-origin addition is limited to the new synthetic QA host.

## Verification

| Gate | Evidence |
| --- | --- |
| Focused database | Suite134: 125/125; eight affected suites: 758/758; portal fixture plus134: 161/161 |
| Full database | 5,671/5,671 across123 files, including129–133 and Subscriptions/Invoices/Projects/Tickets/Forms/Team/financial regressions |
| Application | Focused final6 files:116/116; full228 files:2,990/2,990, two workers |
| Static/build | TypeScript, ESLint, public/private SQL lint and production build pass; secret scan0 findings across1,644 tracked files; final Git checks pass |
| SQL mutations | 20 serial rollback variants detected, including published/role/Tenant/Company/RLS/dependency/archive/new-work/replay/issuer/renewal/notification/activity and incorrect historical-settlement denial. Exact definitions, ACLs, triggers, policies, publication, permissions, catalog/Company, invoice counters and captured business/QA records restored after every variant |
| Coordination | Twenty real two-session operation/publication orderings; two historical-payment orderings; two direct-publication orderings; Repeatable Read/Serializable fail closed. Independent NOWAIT lock probe detects removal of Tenant coordination; both sessions roll back and snapshots match |
| UI mutation | Removing Calendar response-generation protection makes the delayed-feed authorization regression fail; exact source restored |
| Authenticated browser | Ordinary synthetic owner/staff/client/Platform Admin and Tenant B sessions over approved HTTPS; OFF new/edit, live stale-page denial, transient retry, canceled terms/events/calendar, independent receipts, foreign-Tenant refusal and no auto-revival. Seven widths320/360/390/430/768/1280/1440, keyboard/focus/Escape/reduced motion and inspected screenshots |
| Builder | Real PA password session established with QA auto-login disabled, then existing loopback-only builder gate. Review/back/focus, explicit save/refresh and inert published OFF behavior; ordinary owner/Quick Access cannot access PA controls. Only a new synthetic Tenant draft changed |
| Independent reviews | Three genuine native read-only reviews: database/concurrency, financial/replay/history, application/integration. Confirmed findings corrected; no unresolved HIGH/BLOCKER. Reviewers inspected source and recorded evidence without running shared mutations or browser tests |

Verified pre-fix findings included archived Invoice-generation replay visibility, archived-Company cancel/reconcile returns, three legacy notification scope failures and delayed Calendar feed restoration. Corrected assertions fail before fixes and pass afterward. Initial app failures were missing service/context mocks for new route gates; original eligibility assertions remain. Older database fixture failures were global single-Tenant assumptions (083/095) and hard-coded Invoice numbers (027); scope/allocator corrections retain exact catalog, ownership and isolation assertions. Current ownership integrity is not claimed as a new historical backfill proof.

## Limits and deferred work

Privileged Invoice-first/Tenant-second work can deadlock against Tenant-first APIs. Real sessions demonstrate whole-transaction abort and exact rollback; privileged callers must acquire Tenant first or retry the entire transaction with fresh authorization. Uniform lock order or uninterrupted liveness is not claimed. The coordination mutant proves lock detection, not a committed unsafe obligation.

Unscoped database lint reports eight pgTAP extension compatibility/dynamic-cache errors; public/private application functions have zero errors. No third-party extension was altered. The four-module historical checkpoints are not counted as new verification.

Existing Invoice concerns remain for WL-2.38: wallet visibility depends on Invoice capability; refunds are ledger records rather than automatic returned money; pending financial rows lack a verified completion path; app prechecks and some financial replay visibility need separate targeted verification. These were not repaired here. Already delivered data cannot be erased from a user's device; hidden/offline surfaces redact when current authorization is checked.

All business mutation tests are local, synthetic and isolated; pre-existing QA publications/drafts/memberships/domains remain preserved. No destructive reset, hosted write, live payment, external email, push, merge or deployment. Global OS/Skills Index unchanged. Local evidence is under `%TEMP%/wl239-qa`; credential/session files are ignored scratch data and are not committed. Stop after this milestone; Invoices requires a separate instruction.

Skills actually read and applied: ponytail; antislop/core/code/UI/mobile; caveman-explore/review/commit; security-and-hardening; source-driven-development; doubt-driven-development; ponytail-review; ui-ux-pro-max; Supabase; frontend-testing-debugging. Cavecrew informed delegation boundaries; native read-only agents were used rather than unavailable Cavecrew presets. Browser plugin was unavailable, so installed Playwright/Chrome was used without installing tools.
