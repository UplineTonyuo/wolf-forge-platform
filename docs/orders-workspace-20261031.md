# Orders navigation and unanswered replies — local candidate

Worktree: `work/woad-qa-followups-20261030`  
Branch: `codex/woad-qa-followups-20261030`  
Base: `f7038b0a520e3e378087f7c29cfa76924e8e37dc`

## Behavior

- The shared internal navigation and client navigation say **Orders**. Internal module keys, route URLs, existing WF-P references and permissions retain their identifiers.
- The internal **Unanswered** filter and badge use the latest public human message in the authoritative conversation. A client message needs a later public team reply. Reading, reactions, notes, system events and guest messages do not clear it.
- The metadata RPC returns only order ID and a nullable response flag, with a maximum 2,000 requested IDs. Legacy linked Tickets retain precedence. Current access denial never falls back to a different conversation.
- Unavailable metadata stays unknown. The list shows a notice and disables Unanswered when all metadata is unavailable; it keeps authorized Orders visible. This can happen until the new migration is applied.
- Onboarding is removed from client navigation. Orders contains assigned forms and responses, including standalone account forms and completed history. Forms-only accounts can open this landing without reading orders; Orders-only accounts do not read forms.
- Existing assigned-form URLs, drafts, consent, submission handling and automatic PDF receipt/download flow remain intact. Old Onboarding-index links redirect into Orders. The embedded form section retains the existing live visibility/redaction boundary.
- A pending row with known required intake opens its order's start controls. Explicit **Start order** records intent and opens the first still-required frozen form. Page views and form browsing do not mutate start intent. The server alone confirms the working state after all frozen requirements are valid. Failed or unavailable requirements remain blocked.
- Legacy orders with assigned intake and no frozen start gate retain an authorized same-order form fallback. No historical gate is backfilled, and a failed gate lookup never downgrades to legacy.
- The large yellow support banner becomes **Client view · [name]** and **Back to admin account**. The existing secure exit action, original administrator authentication, session audit, expiry and cleanup are unchanged.

## Database change

New local migration:
`supabase/migrations/20261030174401_order_unanswered_metadata.sql`

Full isolated Supabase test:
`supabase/tests/database/181_order_unanswered_metadata.test.sql` — 26 assertions authored, not executed against full Supabase.

Earlier candidate migrations remain separate dependencies as recorded in `docs/qa-followups-20261030.md`. This task applies none to hosted environments.

## Verification evidence

Evidence directory:
`../../outputs/orders-workspace-20261031`

- `unanswered-native-result.json`: **28 native PostgreSQL query/access checks passed** using the exact new migration and access-helper source with synthetic auth/schema prerequisites. The disposable loopback cluster stopped and its PID-file absence was verified. This does not establish full Supabase Auth/RLS/PostgREST acceptance.
- Agent scoped tests: 89 Unanswered tests and 16 support-control/action tests passed. Root permission/navigation/start/legacy/receipt tests passed during implementation.
- Source readback confirms no diff in the existing support exit, form-submit/PDF redirect, client-order-start server action or support proof files.
- The separate skeleton worktree and its two uncommitted files remain separate and untouched.
- Full regression, typecheck, lint and scanner results are recorded in the final verification receipt beside this handoff. Historical test passes are not claimed as new acceptance.

## Manual acceptance — synthetic accounts only

1. Team view: confirm Orders naming. Send a test client's text or voice/attachment-only reply, reload the Orders list, and verify Unanswered beside that client. Reading or adding an internal note must not clear it; a later public team reply must clear it after refresh.
2. Check Unanswered combined with status, client, assignee and service filters. A metadata error must show unavailable status instead of a false answered result.
3. Client view: Orders is present, separate Onboarding is absent. A known required-intake pending row opens start controls. Click Start order; verify the correct first incomplete form opens and Working does not appear early.
4. Complete multiple required forms in order. The final submission must retain its automatic PDF receipt flow and the server must confirm the expected order start. Refresh/back/duplicate clicks must not create another start or duplicate submission.
5. Check incomplete, completed and standalone assigned forms under Orders. Old direct assignment links and downloaded PDFs must remain scoped to the authenticated account.
6. Check Forms-only and Orders-only accounts independently. Revoke a synthetic client's form scope; the existing live boundary must redact it while permitted Orders remain.
7. In a synthetic support session, use Back to admin account. Verify the original team account returns without client credentials and the support session closes. Check expiry and phone widths without hiding the current client-view identity.

The database acceptance, full build and authenticated browser acceptance must be separately evidenced before any rollout. No push, deployment, production data change, Docker startup, RojanCRM operation, or canonical-memory write is part of this task.

## Final local results

- Full initial regression: 3,906 passed and 11 failed of 3,917 tests. Each failure expected an intentionally renamed label or relocated Forms landing route. Only those test expectations changed; the five affected files then passed all 103 tests. The other 315 files passed in the full run. This was not a second full-suite run.
- Full TypeScript check and route generation passed. Typecheck used a 2,048 MiB heap with the existing host guard; minimum observed free RAM was 2.48 GiB and the guard did not stop it.
- Final scoped ESLint passed with zero warnings; generated database types retain their existing lint exclusion. Both changed CSS modules parsed; diff whitespace check passed.
- The unchanged repository secret rules found zero findings across 2,051 tracked and nonignored new files. The scanner extension exists only in the output evidence folder; repository scanning rules and suppressions were not changed.
- Native synthetic PostgreSQL: 28 passed. Full Supabase SQL181 (26 authored assertions) remains unexecuted.
- Build not started: final available RAM 4.20 GiB, below the existing 5.5 GiB safe full-build threshold. No RAM threshold was relaxed, no user app was closed, and no server was started.
- All task changes remain uncommitted and unstaged at the original base. No push, deployment or hosted migration occurred.
- The other skeleton worktree's exact diff matches its saved patch. Canonical notes remain read-only; a proposed steward update is in the evidence directory, not in the vault.