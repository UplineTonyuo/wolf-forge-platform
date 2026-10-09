# WL-2.34 published module enforcement: Phase 1

Base: 4215269. Local only; no saved draft publication or effective policy seeded.

## Canonical architecture audit

public.permission_modules defines account-class/navigation entries. private.white_label_modules is the nine-module subset. Projects, Subscriptions, Coupons and Investment Intent require Services. Existing membership/preset/override resolution is retained.

| Module | Navigation / page / action / API | RPC / existing guards | Unauthenticated / system dependencies | Data ownership / disablement implications |
| --- | --- | --- | --- | --- |
| Services | /services/**, /account/store/**, service/purchase actions | service and purchase RPCs; Services/Store and operational permissions, RLS | Guest/public purchase audit pending; money movement and Project fulfillment | Tenant service/folder, company purchase; dependency for four modules |
| Projects | /orders/**, /account/projects/**, actions, attachment API | order/task/conversation RPCs, operational access helpers | Guest paths audit pending; purchase fulfillment, legacy Ticket conversations | Tenant order/task/messages; requires Services |
| Tickets | /tickets/**, /account/tickets/**, actions, attachment API | Ticket helpers + module/capability guards | Public Contact Form generated Tickets; legacy conversations | Tenant ticket/message; public support policy needed |
| Reporting | /reporting, /reporting/new, /reporting/[reportId], /account/reporting and detail, reporting actions, quick action | Fourteen business RPCs below, editable-report helper, Reporting permissions, direct SELECT RLS | No anonymous/service-role RPC grants; notifications + report-only deliverable ledger; no financial or job consumer | Tenant report/sections/entries, company scope, profile receipts; preserve all historical records |
| Invoices | /invoices/**, /account/invoices/**, actions/payment endpoints | invoice capability/read helpers and RLS | Settlement, webhooks, public guest payments require explicit policy | Tenant invoice/company wallet/payments; financial obligations |
| Subscriptions | /subscriptions/**, /account/subscriptions/**, actions | subscription capability/read helpers and RLS | Renewal/reconciliation, scheduled invoices | Tenant subscription/company/service; requires Services |
| Coupons | /coupons/**, checkout and coupon actions | coupon tenant/permission checks; purchase and invoice callers | Guest redemption audit pending; alters prices | Tenant coupon/redemption; requires Services |
| Investment Intent | /investment-intent, portal Store interest action | service-interest RPCs, operational guards | Internal notification fanout; guest behavior audit pending | Tenant service interest/company; requires Services |
| Forms | /forms/**, /account/forms/**, /f/[canonicalKey], actions | form capability, assigned/public submission checks | Onboarding, Contact Form Tickets, suspended Tenant rejection | Tenant form/version/submission/assignment |

Operations (todo, /todo/**, /api/operations/**) is outside the configurable catalog and retains the Wolf Forge-only gate.

Eight non-pilot modules are not complete audited enforcement slices. Both published-row validation and the trusted writer reject omission of any of them. No money, webhook, reconciliation, scheduled-job, Contact Form or public guest behavior changes.

## Reporting coverage

Business RPCs: app_send_client_report, app_list_my_client_reports, app_get_my_client_report, app_mark_client_report_read, app_count_my_unread_reports, app_create_report_draft, app_save_report_draft, app_send_report_draft, app_discard_report_draft, app_list_internal_reports, app_get_internal_report, app_get_report_send_status, app_list_reporting_service_options, app_list_reported_one_time_deliverables.

The two report-send-anytime grant/revoke RPCs manage existing permissions, not report data; they cannot override disabled policy. ReportingRepository uses user-scoped RPCs only. All five pages already require the correct account-class module. The legacy send RPC checks reports.send without a module call; the recovered migration narrows that permission through profile_has_permission_in_tenant. Both send server actions also check the Reporting module before consuming the durable send quota. The migration covers report direct RLS, unread count, notification readers, explicit-Tenant notification fanout, receipts and historical activity's admin shortcut. The recipient action and Send Reporting quick link have module guards. Notifications have no API table grants. No Reporting API route or background production caller was found. Local database enforcement is verified by the final acceptance evidence below; hosted enforcement is not verified.

## Published authority

Append-only private.tenant_module_publications stores Tenant, explicit revision, canonical module set, server-stamped auth.uid Platform Admin actor/time, and reason. Primary key, Tenant/profile FKs, immutable history trigger and Tenant row lock enforce ordered revisions and concurrency. No API role has table/function access, including service_role. Postgres-only private.publish_tenant_modules requires the existing Platform Admin entitlement and explicit expected revision; it never reads/copies drafts. No operational Publish button/API.

Active Tenant with no row retains existing authorized behavior. Invalid/unknown published state denies; no draft or other Tenant fallback. Effective permission is published predicate AND the existing preset/override/account-class permissions. Only Reporting can be disabled in Phase 1.

## White Label 404 QA issue

Historical pre-reinstall diagnosis (not re-verified on this workstation): port 3000 served Wolf-Forge-Loading-Skeletons-20261007, which had neither the White Label source route nor an entry in its dev manifest. No server for this checkout was initially running. This explained that port 3000 404; the historical manual URL is uncorrelated. Normal login alone does not establish Platform Admin entitlement, non-Quick-Access identity or development/opt-in/loopback gate eligibility. Browser PASS requires real entitled login on this checkout with all gates preserved.

## Verification

Reporting-only Phase 1 is ready for local closure after the final acceptance evidence below. Earlier checkpoint limitations are historical. This does not complete publication UI, runtime branding, or enforcement slices for the other eight modules.

### Database-independent checkpoint — 2026-10-09, Codex

- Fixed both send actions consuming the durable send quota before a Reporting module preflight. Four new action tests reproduced the missing guards before the fix and passed afterward. Existing mutation RPC authorization remains authoritative, including policy changes after preflight.
- Passed 9 focused Vitest files / 140 tests with `npm test -- --maxWorkers=2` (published-module actions/navigation, Reporting service/domain/send window, White Label drafts/actions/builder, internal navigation and Operations navigation). These unit tests use existing application mocks; they do not prove database authorization.
- `npm run typecheck` and `npm run lint` passed. The first typecheck lacked generated Next `PageProps`; documented `next typegen` generated ignored route types, then typecheck passed without changing application types.
- Source review confirmed activity entity `client_report` matches the current constraint, parent-Tenant resolver, Reporting writer and pgTAP fixture. SQL was not executed. No standalone PostgreSQL parser is installed, so this is source consistency review, not SQL syntax or runtime validation.
- Independent read-only security and diff reviews found no blocking issue in the action change; both explicitly excluded database verification.
- Blocked/deferred: migration replay/application, focused pgTAP 130, regression/full pgTAP, database mutation tests, live grants/RLS/RPC/Tenant/publication checks, DB lint, authenticated browser/direct-access QA and final database security review. The original local database and QA records were not restored. KI-106's historical failures are not a baseline for this machine. Docker/WSL setup is deferred; no hosted target was used.
- WL-2.34 remains recovered WIP. WL-2.33 remains the latest completed milestone. No Production changes, push or deployment.

### Final security and authenticated browser acceptance — 2026-10-09, Codex

- Starting branch `feat/white-label-tenant-foundation-20261007`, HEAD `9d7540c0def2106a73843ee7ad1b4f301c67d5c6`, clean tree. Verified local container mapped to DB port 54322, migration `20261010100000` present, no persistent publications. No hosted connection.
- Prior workstation evidence supplied for this session: full pgTAP 5,163/5,163, focused 130 88/88, full Vitest 2,924/2,924, TypeScript, ESLint and DB lint passed. Those full suites were not rerun here.
- Final suite 130 is 112/112: added 24 assertions separating enabled-policy Platform Admin denial from membership denial (module/RPC/detail, reports/sections/entries/receipts RLS, explicit-Tenant permission engine), and checking omission of every one of the eight mandatory modules through both the writer and table trigger. Original disabled owner/client RPC/RLS, permission, cross-Tenant, Operations, draft separation, invalid-state and historical-record checks remain intact. All publication changes are inside rolled-back fixture transactions.
- Seven database mutants detected: policy predicate bypass (42 failing assertions), permission AND weakened to OR (21), Platform Admin permission shortcut (1), Operations Tenant predicate bypass (1), receipt RLS weakened (1), restrictive historical activity policy removed (1), mandatory module validation removed (14, focused prefix). Each variant runs in its own transaction; after rollback, exact function definitions/ACLs, policies, publications, reports, drafts, memberships and Platform Admin records match its secure snapshot. The secure run passes. No persistent QA Tenant publication change.
- Recreated only synthetic identities with existing local QA scripts plus a separate ordinary owner using the same local Auth-admin/profile/membership process. Generated passwords remain in ignored local credential files. Platform Admin logs in through real `/login`; Quick Access is never granted the entitlement.
- Verified environment defect corrected in `supabase/config.toml`: `[auth.email].enable_signup=false` disabled password login (`email_provider_disabled`). Enable the email provider while retaining `[auth].enable_signup=false` and anonymous sign-in disabled. Restarted only this local project with retained data. Container flags confirm email enabled/signup disabled; existing accounts sign in; anonymous `/signup` returns 422 `signup_disabled` and leaves user count unchanged.
- Authenticated browser: this checkout's Next dev server on port 3010; Settings -> White Label -> Tenant B; load, actual proposed name/colors/Reporting review, heading focus, Back state/device/focus retention, save and fresh database read, refresh persistence. Synthetic Tenant B draft is revision 2, named `WL234 Browser QA Tenant B Verified`, primary `#002277`, accent `#cfa54d`, Reporting excluded. Publications remain zero; Wolf Forge has no draft; runtime permissions/memberships and historical reports unchanged by draft saves.
- Ordinary owner: White Label entry absent and direct route denied. Passwordless QA session: direct route denied and no Platform Admin entitlement. Development opt-in off and production-mode tests reuse a legitimately authenticated admin session: ordinary Settings works, White Label entry absent and direct route renders 404 denial UI (streamed HTTP 200); no editor controls. Production QA flag cannot enable the route.
- Tenant B real client login on `https://qa-b.wolf-forge.local:3010/account/reporting` succeeds and Reporting remains available despite its disabled draft; draft branding is not runtime branding. Plain HTTP on the `.local` hostname cannot run BotID WebCrypto; use local HTTPS with a temporary certificate, preserving authentication/BotID/Tenant gates. Loopback HTTP admin flow works. Self-signed-certificate server redirect optimization falls back to browser navigation; no authorization bypass. Inherited report-only CSP/dev resource diagnostics are not a clean-console claim.
- Rendered QA: 320/360/390/430/768/1280/1440px, Proposed column visible and no page overflow; Tenant menu open/Escape at 390; screenshots outside the repository. No application page error in the successful White Label flow; the initial insecure-origin login error was isolated and resolved by HTTPS, without changing application code.
- Fresh final checks: production build (including TypeScript) passed; working/staged diff checks pass. Three independent read-only reviews (database authorization, adversarial Tenant isolation, application/migration diff) have no blocking finding; final test/config corrections also reviewed. No business implementation or migration change, no external email/payment action, no hosted/Production write, push or deployment. Temporary QA servers stopped; local Supabase retained.
- Result: Reporting-only WL-2.34 Phase 1 is ready for local closure. Remaining scope is publication UI, published branding, separately audited enforcement for other modules, and hosted rollout verification. Those are not implied complete.
