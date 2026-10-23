# WL-2.34 Phase 2: Investment Intent enforcement

Local implementation based on `b11559477e9e8a9c6729081ce0ead9933b1adfa1`.
Reporting Phase 1 remains the reference in [the preceding handoff](wl-2.34-published-module-enforcement.md).

## Product boundary

Published Intent enablement narrows existing authorization; it never grants a
missing membership, permission or account class. No publication preserves the
existing authorized behavior. Drafts are never runtime authority.

| Disabled Intent | Behavior |
| --- | --- |
| Internal list, status management, navigation and direct page | Denied through existing module/permission checks |
| New client interest recording, including cart removal signals | Denied before interest quota, writes and fanout |
| New investment Ticket | Requires Intent and Tickets, plus existing Ticket authorization |
| Existing investment Ticket replay and conversations | Existing Tenant-scoped Tickets authorization remains authoritative |
| Ordinary support Ticket | Unchanged |
| Interest notifications / activity | Storage retained; module-specific disclosure and notification marking denied |
| Cart, eligible Service purchase and settlement | Unchanged |
| Purchase cleanup | Existing trusted transaction closes only the purchasing company's historical interest in the purchased Service |
| Historical interests, status activity, cooldown and publication revisions | Retained; access restored on re-enablement |

The investment marker is `tickets.investment_service_id`, validated against the
resolved Tenant's Service. A subject, category label or browser-selected Tenant
does not establish that relationship. Accepted create-request replay returns
only an existing Ticket of the current Tenant; it creates no new investment work.

## Winning enforcement paths

- Migration `20261010110000_investment_intent_module_enforcement.sql` extends
  `private.published_module_set_valid` and
  `private.profile_has_permission_in_tenant` without changing their signatures,
  grants, membership resolution or Reporting conjunction.
- `public.app_record_store_interest(uuid[],boolean)` checks the server-resolved
  Tenant's published Intent policy after existing client/Store authorization and
  before either interest quota call. There are no anonymous recording grants.
- `public.app_create_ticket(uuid,jsonb)` checks both published predicates for a
  new investment Service relationship before quotas. Existing role, replay,
  company/client and same-Tenant Service validation remain intact.
- Existing `app_list_investment_intents(integer)` and
  `app_set_investment_intent_status(uuid,text)` inherit the narrowed permission
  engine. The management server action also preflights Intent before mutation.
- `service_interests_internal_select` inherits that same permission conjunction.
  Direct interest SELECT/write privileges remain revoked for API roles. Suite
  131 grants SELECT only inside its rolled-back transaction to exercise RLS as
  an additional boundary.
- Internal Store notification categories already map to `investment_intent.view`.
  Existing subject-Tenant fanout, list, mark-one and mark-all inherit the narrowed
  engine. Direct notification table access remains revoked; unread counts derive
  from the authorized list. No new notification system or grants.
- Restrictive `activity_events_published_investment_intent` SELECT policy closes
  the existing admin activity shortcut for `service_interest` only, composing
  with existing Tenant/account-class RLS.
- `app_purchase_service_with_balance(uuid,uuid,text)` is unchanged, including
  its company-and-Service-scoped historical interest cleanup. No Intent gate is
  introduced into carts, invoices, payments or wallet settlement.

Reporting and Intent may be omitted from a valid published set. Services,
Projects, Tickets, Invoices, Subscriptions, Coupons and Forms remain mandatory.
Services dependencies, duplicate/unknown rejection, Operations exclusion,
append-only revisions and the existing postgres-only Platform Admin writer and
trigger remain authoritative. The migration seeds no publication.

## Local verification — 2026-10-09, Codex

- Focused suite 131: **85/85**; Reporting suite 130: **110/110** (each of the two
  mandatory-module loops now has seven entries). Relevant suites 028, 037, 102,
  104, 107, 123 and 124 pass.
- Suite 028 initially failed its final cooldown recipient count (10 versus 4).
  Existing QA capability holders legitimately receive fanout. Scope this last
  assertion to the same fixture owner/admin recipients used by its earlier
  assertions; preserve the expected four notifications and production behavior.
- Full pgTAP: **5,270/5,270**, 120 files. Full Vitest with two workers:
  **2,930/2,930**, 220 files. Focused application tests: **73/73**, six files.
- Ten serial mutants detected: permission/module conjunction, recording policy,
  cross-Tenant membership, direct interest RLS, activity disclosure, notification
  disclosure, pre-quota ordering, publication validation, investment Ticket
  predicate and Tickets coupling. Every transaction restores exact function
  definitions/ACLs, policies, table grants and snapshot data. The quota sentinel
  proves refusal precedes a quota call even though SQL errors roll writes back.
  The isolated Tickets probe tests that predicate independently without
  publishing an unsupported product configuration; exact definition restored.
- Real synthetic owner/client logins on local HTTPS: enabled status management;
  disabled stale-action refusal, hidden navigation and direct-route redirection;
  historical investment conversations in ordinary Tickets/Inbox; ordinary support
  creation; refused interest telemetry with unchanged history/fanout/quota and a
  retained cart; purchase confirmation opened and cancelled; inert enabled draft;
  historical restoration on re-enablement. No browser payment settlement.
- Rendered and inspected menus/filters at 320/360/390/430/768/1280/1440px; no page
  overflow, dialog focus, Escape and focus return pass. Successful flow has no
  application page errors. Inherited report-only CSP diagnostics remain.
- A new isolated synthetic Tenant (`wl234-intent-browser`) has two publication
  revisions (disabled then enabled), an enabled draft and synthetic history.
  Existing Wolf Forge/Tenant B publication, draft, membership/domain and business
  rows are preserved. Ordinary login expires old auth quota rows normally;
  refused interest requests do not consume interest quota.
- Exact `qa-intent.wolf-forge.local` added to the existing development-only
  `allowedDevOrigins`; otherwise Next blocked HMR and hydration. Installed Next
  documentation confirms the mechanism. Production, authentication, BotID and
  route restrictions are unchanged. Local HTTPS uses the previously approved
  temporary certificate arrangement. Browser plugin skill unavailable; installed
  Playwright used. No dependency installation.
- TypeScript, ESLint, database lint, production build, secret scan and working/
  staged diff checks pass. Final targeted local-QA/action/cart tests: **38/38**.
  Generated `next-env.d.ts` returns to its tracked production form after build.
- Three independent source-only, read-only reviews (database authorization,
  adversarial workflows, final integration) found no BLOCKER/HIGH. Integration
  reviewer also reviewed the notification test additions, suite 028 correction
  and exact-host development configuration.

No destructive reset, hosted write, email delivery, live payment, push or
deployment. Publication UI, runtime branding, seven other enforcement slices
and hosted rollout remain deferred. Recommended next slice: Coupons, after an
explicit redemption/financial-history disablement decision.
