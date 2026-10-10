# WL-2.37 Tickets published-module enforcement

Local implementation from `93f6fa11a921240647f91d42b926d9fab38e51d2` on `feat/white-label-tenant-foundation-20261007`. The complete supplied `wl237-tickets-lifecycle-audit-claude.md` was read before editing. Its author was Codex; the filename does not establish an independent Claude review. Findings were reconciled with executable local SQL.

## Approved behavior

- Drafts may omit Tickets. Publication refuses any non-archived Ticket whose status is not `closed`; `resolved` still blocks. Archived unresolved Tickets remain stored and become inaccessible while Tickets is OFF. Builder and Review explain that safeguard.
- Projects ON requires Tickets ON. Disabling both also retains the existing unfinished-Projects precondition. Invalid draft combinations are not silently rewritten, published or activated. Reporting, Investment Intent, Projects and Tickets are optional; Services, Invoices, Subscriptions, Coupons and Forms remain mandatory. Operations stays Wolf Forge-only.
- Tickets OFF restricts list/detail/replay, messages, notes, quotes, reactions, forwarding, attachments/download bytes, presence, notification titles/snippets/counts and activity. Re-enablement restores existing authorization. Previously forwarded Team copies remain governed by Team permissions.
- Contact Forms still accept submissions under their own authorization and limits. Answers/provenance remain immutable; no Ticket/message/fanout is generated. The outcome is stored with null orchestration and `not_required`, and re-enabling Tickets does not convert these receipts. Employees can review them through Forms. Accepted historical Form receipts remain available without exposing their associated Ticket content.
- Investment Intent recording remains independently authorized by its own module, Services and client permissions. New investment Tickets still require Tickets. Existing carts, accepted purchases, financial receipts and financial history keep their established rules.

## Authoritative implementation

Forward migration `20261010140000_tickets_module_enforcement.sql` changes 28 existing function definitions, adds three private helpers and seven write triggers, and seeds no publication or draft. Existing function ACLs, revoked table grants and RLS remain intact.

`private.profile_has_permission_in_tenant` narrows all seven `tickets.*` permissions with the published predicate. `private.can_access_ticket` retains Tenant, Company, membership, role and linked-Project checks. Its existing callers cover projections, messages, downloads, presence and activity. The API table grants remain revoked; direct RLS and trusted writes are separately tested.

`private.require_tickets_write` and `private.lock_tenant_module_lifecycle` reuse the authoritative Tenant row. Ticket creation/reopening/lifecycle, trusted Contact generation and native/legacy Project conversation writes coordinate with both `private.publish_tenant_modules` and the direct publication trigger before new side effects. Writes require READ COMMITTED; higher isolation fails closed instead of trusting a stale post-wait snapshot. Auth-null, no-publication setup compatibility remains; it is not an authenticated bypass.

`public.app_create_ticket` rechecks current Ticket visibility on an exact accepted replay, after actor/payload binding. It cannot return a hidden Ticket because a request ID matches. Trusted legacy inserts also verify the actual Order's Tenant and Company. `app_list_investment_intents` does not expose inaccessible active-Ticket identifiers/status.

`app_submit_form` locks the Form's authoritative Tenant before Contact orchestration. `private.create_ticket_from_contact_submission` independently skips disabled Tickets before creation. Notification list, mark and mark-all use the same current Ticket entity predicate, including alternate notification categories.

Application route gates and typed live/Inbox denials clear protected page metadata, transcripts, selections and reply controls. Ordinary network failures retain retryable state. The mounted internal shell and client page boundary redact protected content while route refresh is pending. Poll lifecycle cancellation is scoped to its effect so StrictMode remounts and late responses cannot stall or revoke another Ticket.

Cached search and notification projections use current trusted availability before rendering, completion, keyboard selection, counts and feedback. Project search results and `order`/`order_task` notifications follow the Projects/Tickets dependency; independent invoice, wallet, Intent and Team entities remain visible. Notification entity metadata survives server-action normalization.

The existing typed-denial signal also invalidates Ticket-only Inbox, search, notification and client navigation-count caches before a pending route refresh completes. Request generations prevent responses started before that denial from restoring Ticket projections or delayed chimes. Fresh successful authoritative reads may restore authorized rows; ordinary network failures alone do not invalidate caches.

Failed attachment finalization no longer deletes Storage bytes that a concurrent accepted same-ID retry may own. Unreferenced uploads stay private pending verified reconciliation; no general cleanup privilege is added.

## Verification and limitations

Focused suite133 has 134 assertions. Serial mutation evidence, independent-session races, full regression results and authenticated browser evidence are recorded in the canonical QA/Security notes and machine-local `%TEMP%/wl237-qa` artifacts. Three real native reviewers inspect database/concurrency, conversation/history, and integration/UX scopes read-only; runtime checks are performed by the primary writer.

| Gate | Final local evidence |
| --- | --- |
| Database | Focused133:134; full pgTAP:5,551 passing,122 files; DB lint passes |
| Application | Focused denial/cache:51 passing,7 files; full Vitest:2,978 passing,227 files,two workers |
| Quality | TypeScript, ESLint and production build pass; final tracked-file secret/diff checks recorded at delivery |
| Mutations | 15 authorization and two coordination mutants detected; secure controls and exact restoration pass |
| Races | Both orderings of creation/reopening/Contact versus publication; Repeatable Read/Serializable fail closed; privileged row-first contention safely aborts |
| Browser | Ordinary owner/staff/client/Platform Admin/Tenant B authentication; full-page and stalled-feed cache redaction, real private PDF bytes denied/restored, Forms-only employee retrieval, Intent recording, financial receipts, acknowledged Team group send |
| Builder/accessibility | Saved Tickets OFF draft remains inert, actual Review differences, Back focus, save/refresh, owner/Quick Access/environment gates; seven widths320/360/390/430/768/1280/1440, opened picker/conversations, keyboard/Escape/reduced motion |
| Reviews | Three independent native read-only source reviews: no unresolved HIGH/BLOCKER; no independent runtime execution claimed |

Publication/creation, publication/reopening and publication/Contact tests exercise both transaction orderings. Repeatable Read and Serializable lifecycle attempts fail closed. Privileged direct row-first UPDATE can deadlock against normal Tenant-first writes: PostgreSQL safely aborts one transaction with `40P01`. Privileged callers must lock the Tenant first or retry the whole transaction with fresh authorization; uninterrupted liveness is not claimed.

Already delivered bytes and authorized Team snapshots cannot be remotely erased. Hidden/offline tabs redact when they receive or resume a current denial. Authorization and external Storage byte transfer are separate operations; an already-authorized in-flight transfer is not remotely revoked.

Regression reconciliation preserves original error contracts in091/092. Persisted QA data also exposed obsolete fixture assumptions in036 (temporary category probe omitted Team),047 (unscoped digest queries), and099 (all overrides assumed Wolf Forge). Those tests now retain valid Team categories, scope their fixture recipient, and verify actual Tenant membership ownership; meaningful authorization assertions remain.

Only new isolated Tickets browser/race Tenants receive synthetic publications and business fixtures. Existing QA drafts, publications, memberships and domains are preserved. No destructive reset, external email, live payment, hosted write, Production change, push, merge, deployment, Publish UI or next-module implementation.
