# WL-2.36 Projects published-module enforcement

Verified locally from 8d73068b72b633d64eeeb778bb0d7050cb7f756b on feat/white-label-tenant-foundation-20261007. The complete supplied Claude lifecycle audit (reference d2bbaa3) was read before editing and reconciled with this checkout and executable SQL. No hosted writes, push, merge, deployment or next-module implementation.

## Approved behavior

- Drafts may omit Projects. Publication refuses non-archived Projects with status other than complete or canceled; completed Projects retain the existing completed_at invariant. Refusal leaves draft/publication revisions unchanged.
- New Service purchases require published Projects after exact accepted-request replay and before quotas, coupons, invoices, wallet/payment settlement, Project creation, notifications/activity or Interest cleanup. Ordinary purchase permissions remain; projects.create/view are not added. Accepted replay returns the original result without another charge and opens its financial receipt.
- Native Project conversations and legacy Tickets identified by trusted tickets.order_id require applicable Projects/Tickets authorization. Ordinary support and Investment conversations without Projects keep their existing boundaries.
- New Project intake assignment requires Projects. Accepted assignment replay, historical assignments/answers, unrelated onboarding and ordinary public submissions remain authorized through Forms.
- Project-specific activity/notifications are hidden while disabled. Stored Projects, messages, attachments and financial records remain intact. Invoices, payments, refunds, wallet history and financial dashboards retain independent authorization.

## Executable implementation

Forward migration 20261010130000_projects_module_enforcement.sql seeds no drafts or publications. It replaces 29 enforcement definitions, corrects one notification comment without changing that body, and adds one authenticated Store availability reader. All 30 replaced definitions match executable local SQL exactly after line-ending normalization; the new reader and its grants were separately reviewed.

Reporting, Investment Intent and Projects are optional; six other modules remain mandatory. Services dependencies, unknown/duplicate rejection, Operations exclusion and append-only revisions remain enforced. No-publication compatibility, Tenant membership, role permissions and Platform Admin/business-data separation remain intact. Drafts are never runtime authority.

The existing engine narrows projects.view/create/edit/assign/archive. Operational order/task helpers require projects.view in addition to their existing Tenant/assignment/client scope. Direct RLS, creation/reopening triggers, Project/task mutations and existing native conversation helpers enforce the published predicate. Legacy Ticket access and five management RPCs enforce the trusted Project relationship. The existing boolean private.can_access_ticket(uuid) has authenticated EXECUTE for the restrictive activity policy, without new table access. Trusted service-role insertion grants remain; anonymous/authenticated direct writes remain revoked.

Three notification list/mark readers enforce Project and linked-Ticket visibility. NULL legacy metadata stays compatible. SECURITY DEFINER parent-Tenant resolution avoids an invoker-RLS-hidden-row disclosure bypass. Activity uses the existing Ticket authorization helper. No invoice/refund/wallet authorization functions changed.

app_purchase_service_with_balance retains authentication, original Service/Invoice authorization, exact payload replay matching, trusted Company selection and atomic economic flow. app_assign_form retains accepted replay before its new intake gate. app_store_purchase_projects_enabled() returns only the current authorized Store client's published module availability; it grants no Project permission, accepts no target Tenant, and reads no drafts.

Application gates cover Project create/edit/bulk actions and /orders/**. Existing navigation/search/dashboard projections remain authoritative. Store explains purchase unavailability before confirmation, maps database refusal, and routes historical replay or purchasers lacking Project-page access to receipts. WL-2.35 preferences/defaults remain unchanged; draft guidance describes three optional published modules and unfinished-work refusal. Only the exact local HTTPS QA hostname was added to development origins.

## Transaction coordination

Publication writer and insertion trigger lock the authoritative Tenant row before checking unfinished work/revision. New purchases acquire that same lock after replay and before quotas. New/reopened unfinished Projects lock it before trusted insertion exceptions. Lifecycle writes require READ COMMITTED (PostgreSQL Read Uncommitted is equivalent); higher isolation fails closed with 55000 instead of relying on a stale snapshot after a wait.

Publication does not lock Project rows, preventing reverse Project/Tenant lock order during reopening. Purchase takes the Tenant before financial locks; its existing request advisory lock remains first. Accepted replay needs no lifecycle lock. Auth-null no-publication compatibility remains, including trusted inactive-Tenant setup; any publication requires the module predicate even for trusted insertion.

## Verification

Machine-local evidence: %TEMP%/wl236-qa. One writer serialized database mutations. Suite132 uses transaction-scoped fixtures, including native and legacy conversation/attachment enforcement.

| Gate | Evidence |
| --- | --- |
| Focused database | 090/129/130/131/132: 468 passing; suite132: 147 |
| Full database | 5,421 passing, 121 files; database lint empty findings |
| Focused application | 110 passing, eight files |
| Full application | 2,954 passing, 223 files, two workers |
| Quality | TypeScript, ESLint, production build, secret scan and diff checks pass |
| Concurrency | Six independent-session publication/purchase, INSERT and reopening orderings; lock waits observed; higher-isolation refusal |
| Mutations | 16 serial authorization mutants and two rollback-only concurrency mutants detected; secure controls pass; definitions, ACLs, policies and stored business/QA data restored exactly |
| Browser | Ordinary synthetic owner/client/Platform Admin/Tenant B authentication over local HTTPS; enabled/disabled navigation, Project routes/legacy conversations, support, public Forms/intake, invoices, stale purchase refusal and accepted replay |
| Builder/accessibility | Saved draft inert; actual Review differences, Back focus, save/refresh; owner/Quick Access/environment gates; widths320/360/390/430/768/1280/1440, opened picker, Escape/focus, no overflow, reduced motion |
| Independent reviews | Database/concurrency, economic/history, workflow/UI: no unresolved BLOCKER/HIGH; source and recorded runtime evidence reviewed, without independent DB/browser reruns |

## Verified defects and regression reconciliation

- Operational order/task scope ignored explicit projects.view denial. Two direct-RLS reproductions returned one row instead of zero. The permission conjunction fixes this; assertions and separate mutants detect removal.
- Internal Order reads embedded a removed orders-to-profiles foreign key, producing actual PostgREST PGRST200, list errors and intake404. The repository reuses the authorized batched operational-assignee projection, preserving avatars and unassigned nulls; four regressions and browser reads pass.
- Initial full-suite failures exposed error-contract ordering, NULL notification metadata and trusted auth-null/no-publication setup. Secure fixes preserve original authorization/not-found behavior. Older090/092/094 tests assumed all persisted local Forms/Orders/Invoices belonged to Wolf Forge; assertions now verify trusted Tenant defaults/Company ownership. Security assertions remain. Mandatory loops130/131 exclude only newly audited Projects.
- Early development navigation/hydration warnings and browser harness timing/locator assumptions were investigated. Final controlled renders, builder and replay runs have no page errors. Clean baseline/final renders do not establish that the Fragment layout change alone caused their absence.

Only new isolated wl236-projects-browser and wl236-projects-race Tenants received synthetic publications/data. Existing QA publications, drafts, memberships, domains and audit history were preserved. Rollback sequence gaps are not stored records. No external email, live payment, destructive reset, authentication bypass, Publish/Activate UI or other-module enforcement.

Operational publication UI, remaining six enforcement slices and hosted rollout remain deferred. Stop after the focused local commit. Canonical memory records delivery SHA and final checks.
