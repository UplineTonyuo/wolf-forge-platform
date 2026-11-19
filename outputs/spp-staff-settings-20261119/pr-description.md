# Staff Settings and workspace Process workflows

## Summary

Settings replaces the staff sidebar and mobile navigation while preserving the six business settings routes and the independent Team grants for Members and All Conversations. Process covers Orders, Tickets, Clients, Messaging, Saved replies and Tags.

```text
Client opens a completed order → receives its exact completion timestamp
Client submits a reason, completion timestamp and request UUID
  → authorize the conversation → lock workspace, then order
  → replay the matching receipt, or verify the observed completion
  → record revision, assign destination, clear completion and write history atomically
Staff list and detail → read the persisted stage key → resolve the workspace label
```

Existing orders keep their lifecycle and a null custom-stage key. An unconfigured workspace receives the seven built-in order stages, including one each for `waiting_reply` and `pending_update`. A custom stage stores a stable key alongside the working lifecycle. Renames and reordering preserve assignments and the configured reopening destination.

## Second review follow-up

| # | Disposition | Evidence |
|---|---|---|
| 1. Lock order | Addressed in the review migration | Ordinary edits and staff reassignment now take the tenant lifecycle lock immediately before their order UPDATE. Their permission trigger reuses the lock. The replacement preserves the existing checks, field allowlist, assignee validation and activity recording. All five edit, assignment and reporting replacement targets had exactly one matching lock insertion point in the baseline SQL. The acceptance plan overlaps writers during acquisition in separate sessions. |
| 2. Revision replay | Addressed in the review migration | The revision RPC checks current identity, tenant, company, conversation access and submitted payload before returning an existing receipt. Ticket closure or archival blocks new requests. The authored cases cover a closed ticket, the original receipt, a denied new request, preservation of the later completion and denial of the exact retry after order access is revoked. |
| 3. Staff order badges | Addressed and component-tested | Client Overview, Client Projects and Operations Tasks use the same workspace stage resolver as Orders. The label and color come from the configured entry. The persisted lifecycle still determines inclusion in open, overdue, unassigned and waiting lists. Tests render “Needs Review” on all three surfaces. |
| 4. Immediate Settings Back | Addressed and component-tested | During entry the sidebar uses the captured local URL. Once Settings commits it reads that history entry’s origin. Tests cover immediate Back from filtered Clients, the query and fragment, reload, history traversal and the Dashboard fallback for a genuine direct entry. |
| 5. Edit Client status picker | Addressed and component-tested | The shared AnimatedSelect displays the configured labels and ordering. The keyboard regression chooses “Prospect” and verifies that the action receives the stable key `lead`. |

The verified B-owner and B-client membership rows are intact. The acceptance SQL now has B’s authenticated client successfully rate its own order and resolved ticket and revise its own order into B’s configured stage, alongside the foreign-resource denial and preservation assertions.

## Second review local verification

The five new UI assertions failed on the previous implementation. With the fixes, the focused run passed 165 tests across 12 files.

```powershell
npm.cmd test -- --maxWorkers=3 src/tests/client-detail-invoices.test.tsx src/tests/client-detail-actions.test.tsx src/tests/client-detail-loading.test.tsx src/tests/team-todo-section.test.tsx src/tests/internal-shell-navigation.test.tsx src/tests/mobile-navigation.test.tsx src/tests/order-revision.test.tsx src/tests/order-note-action.test.ts src/tests/reporting-owned-service-actions.test.ts src/tests/projects-read-model.test.ts src/tests/projects-workspace.test.tsx src/tests/process-editor.test.tsx
```

- `npm.cmd run typecheck -- --incremental false` passed.
- `npm.cmd run lint` passed with zero warnings.
- `npm.cmd run build` completed the production build, generated 10/10 static pages and collected build traces. This run used the default local build directory and the repository CI’s loopback Supabase/Sentry URLs and nonsecret build key.
- `git -c core.safecrlf=false diff --check` passed for tracked changes.
- The read-only source check found each migration replacement anchor exactly once in its target function and matched the original three-field membership tuples.
- The shared Graphify build and publication SHAs differed. The lock and permission traces used the current worktree source.
- The final independent source review found no blocking issue in the five corrections or in the setup for workspace B’s positive controls. The privileged event-count assertion still needs a separate signed-in staff history read.

## Original review dispositions

| # | Review finding | Correction and evidence |
|---|---|---|
| 1 | Full Process reads available to restricted staff | Full configuration reads and saves share `private.require_process_manager()`, which requires internal owner/admin membership and Settings access. Staff stage lists use module-checked `app_process_entries`. Templates require Tickets access and reply permission. Resource tag reads return assigned definitions to viewers and assignable definitions to editors. Conversation reads expose the lock flag. Regression tests cover the shell reads. The SQL includes authorized and denied reads. |
| 2 | Opposing order and workspace lock order | Custom assignment, client revision, ordinary status change and the three report/month writers acquire the workspace lifecycle lock before the order row. The order permission trigger can reacquire that workspace lock during active transitions. The status writer retains completion authority and the existing monthly-report trigger. Each report patch checks for a single baseline match. Two-session lock and retry checks are specified in the SQL. |
| 3 | Invitation policy blocks contact and invoice mail | Contact and invoice workflows check the ordinary Gmail connection and permissions. Welcome email and invitation provisioning additionally check the workspace issuer policy. The token writer enforces it in the database, alongside existing imported-client protections. Tests cover authorized non-owner contact and invoice mail with owner-only invitations enabled, using mocked delivery. |
| 4 | A retry can reopen a later completion | The UI submits the exact timestamp from the client read and reuses its request UUID on a transport retry. The RPC records the actor, order, request, completion, destination and reason. Exact retries return the original receipt. A different payload conflicts, and a new request for a stale completion is refused. Unit tests cover the form and action. SQL exercises an immediate retry and delayed replay after re-completion. |
| 5 | Staff cannot see the revision reason | Authorized Order History displays the submitted reason as text on its revision event. The history regression checks the rendered reason. SQL asserts one event with the original reason. |
| 6 | Bulk change silently selects the first stage | Opening the dialog clears the selection. Apply and its handler require an explicit key in the current workspace choices. A regression moves Canceled first and verifies that the dialog sends nothing until a stage is chosen. |
| 7 | Filters and Team display built-in status names | Ticket filters, Team ticket inbox rows and client filters consume the ordered workspace entries used by the badges and client rows. Selection and filtering retain the stable keys. Component tests use renamed and reordered statuses. |
| 8 | Ratings and revision lookups lack matching indexes | Ratings aggregate against `(kind, target)` for orders and tickets. Client resources skip the aggregate. Revision uniqueness on `(order_id, actor, request_id)` and `(order_id, expected_completed_at)` supports replay and the permission trigger. SQL includes the client result and authorized rating reads. |
| 9 | Oversized saved replies truncate a draft | The shared ticket/order composer checks the combined length before changing the draft, explains the 50,000-character limit and asks the sender to shorten the draft, and preserves the text. Both composers have tests at 50,000 and 50,001 characters. |
| 10 | Settings Back loses the origin after reload | Each Settings history entry retains the originating same-origin path, query and hash, scoped to the current user and workspace. Back uses Dashboard for a fresh direct entry. Component tests cover reload, Settings sections and browser Back/Forward. |

## Earlier local verification

These results came from the first implementation pass on `codex/spp-staff-settings-20261119`. The subsequent read-only review ran 304 focused tests before the five corrections above.

| Command | Result |
|---|---|
| `npm.cmd test -- src/tests/internal-shell-navigation.test.tsx src/tests/projects-workspace.test.tsx src/tests/mobile-navigation.test.tsx` | 93 tests passed across 3 files, including destructive-first stage ordering and Settings return navigation. |
| Final focused run (command below) | 250 tests passed across 11 files after the build. |
| `npm.cmd run typecheck` | Passed. |
| `npm.cmd run lint` | Passed with zero warnings. |
| `npm.cmd test -- --maxWorkers=4` | 4,977 tests passed across 419 files. |
| `git -c core.safecrlf=false diff --check` | Passed. |
| `npm.cmd run build` | Passed. The optimized build compiled, generated 10/10 static pages and finished collecting build traces. |

<details>
<summary>Final focused command</summary>

```powershell
npm.cmd test -- --maxWorkers=3 src/tests/internal-shell-navigation.test.tsx src/tests/mobile-navigation.test.tsx src/tests/projects-workspace.test.tsx src/tests/projects-read-model.test.ts src/tests/process-editor.test.tsx src/tests/order-revision.test.tsx src/tests/shared-shell-reads.test.tsx src/tests/client-contact-email.test.ts src/tests/tickets-frontend.test.tsx src/tests/team-tickets-pane.test.tsx src/tests/clients-filter-panel.test.tsx
```

</details>

Additional focused runs passed for Process, shell and conversation reads (39), revision and reporting (37), and email, labels and saved replies (169). These counts overlap the full suite. The prior review also verified zero counts for all seven built-ins and All on empty input, and independent totals for two custom stages. That direct probe was earlier evidence. The production build used the environment from `.github/workflows/security.yml`, including the QA build output directory and loopback placeholders.

## Migration and outstanding acceptance

- **Review migration** — `supabase/migrations/20261119040000_workspace_process.sql`. Replacement function definitions are confined to this new migration. Application reads and writes depend on its RPCs. Review the application and SQL together.
- **Authored pgTAP** — `supabase/tests/database/215_workspace_process.test.sql`. The cases switch authenticated actors and workspace selectors, check restricted manager/workflow reads, attempt foreign resource changes through public RPCs, and read back the original workspace’s records. They also reject a foreign-only stage or tag on the caller’s own order and assert that its local assignments survive. They also cover new-workspace defaults, both legacy assignments, native and linked-ticket message storage, revision replay, staff history data, ratings, the reporting guard and owner-only token issuance. Both legacy fixtures use the pre-custom-stage row shape. Checking an existing dataset across migration application and executing pgTAP remain pending.
- **Separate sessions** — Overlap ordinary edits and staff reassignment with stage, status and reporting writers while locks are being acquired. Run both arrival orders. Race revision against staff status changes and compare identical and distinct requests for one completion. Verify final state, receipt and event counts, and absence of deadlocks. These schedules await a separately authorized isolated database.
- **Authenticated UI** — Configure “Needs Review,” lock and complete an order, request a revision as its client, then independently reload the staff list and detail. Rename and reorder the stage and repeat the reloads. Verify the reason, lock behavior and workflow controls with real role boundaries. Confirm return-to-origin, direct entry, keyboard focus, browser history and mobile menus at 320, 360, 390, 430, 768, 1280 and 1440 px. Live Gmail delivery and applied-database query plans also remain unverified.

## Tier L implementation log for the memory steward

Codex · 2026-11-20 · local branch `codex/spp-staff-settings-20261119` · HEAD and merge base `8644064776b1801fa29e43428b2bca3d0e6d88e7`.

Corrected all ten staff Settings review findings in the Process migration, server actions, email permission helpers, staff shell, order history and bulk editor, ticket and client controls, and shared composer. Added regressions in the existing Vitest suite and expanded database test 215. The local verification table records this pass. The next checkpoint is a second code and migration review. Applied-database and authenticated UI acceptance require separate authorization.

**Second review follow-up · 2026-11-20 · Codex.** Corrected the two ordinary order writers and closed-ticket receipt replay in `20261119040000_workspace_process.sql`. Expanded `215_workspace_process.test.sql` with same-workspace client controls, revoked-access replay and a lock-acquisition schedule. Updated the staff order badge, Client detail, Operations Tasks, Settings origin and Edit Client picker, with five new UI regressions. The 165 focused tests, typecheck, lint and production build passed. Next checkpoint is local code and migration review. Applied-database results, concurrent execution, independent authenticated list/detail reloads and staff history reads remain pending.
