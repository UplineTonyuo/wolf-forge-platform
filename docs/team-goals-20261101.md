# Team Goals — local implementation handoff

Implementation checkpoint: branch `codex/team-goals-20261101`, base `9101bae26b3c882edceb6dfdbe034869c03511f7`. This handoff records local implementation evidence. The user subsequently authorized WOAD rollout; release receipts in `outputs/team-goals-release-20261101` outside the repository track the actual commit, CI, backup, migration and deployment state. Do not infer that rollout succeeded from this implementation handoff.

## Implemented scope

- Team navigation group: existing Members and All Conversations keep their original grants; Goals is available to verified internal members.
- `/team/goals`: photo cards, server-filtered visibility before bounded 50-item pagination, new-goal editor and native print of the shown goals.
- `/team/goals/[goalId]`: description, optional photo, responsible person, due date, checklist, automatic equal-weight progress, edit/replace photo and native print.
- Owner/Admin manage all goals in their current Tenant. Manager/Staff see shared goals and can update milestones only on goals assigned to them. Leadership goals require a leadership assignee. Clients, anonymous callers and other Tenants have no access.
- One optional JPEG/PNG/WebP cover, 2 MiB maximum. The private server transport checks current authorization before buffering/Storage work and again before serving bytes. It does not issue public or reusable signed links.
- Idempotent creation, optimistic revision checks, preserved milestone IDs/completion on edits, and membership/role checks repeated after database waits.
- Destination-shaped list/detail skeletons, existing select/date/sheet controls, labeled pending/error states and reduced-motion support.

No comments, reminders, chat, charts, automation, crop editor or new task system were added. Actor attribution is stored on goal/milestone rows; there is no activity-feed feature.

## Files

- `src/domain/goals/schema.ts`, `src/repositories/goal-repository.ts`, `src/services/goal-service.ts`.
- `src/app/actions/goals.ts`, `src/app/api/team-goals/[goalId]/photo/route.ts`.
- `src/app/(internal)/team/goals/**`, `src/components/goals/**`.
- Existing shell navigation/skeleton files and the seven RPC entries in `src/lib/supabase/database.types.ts`.
- Migration `supabase/migrations/20261031185018_team_goals.sql`; real pgTAP-format test `supabase/tests/database/186_team_goals.test.sql`.
- Seven focused Goal test files plus the updated mobile-navigation expectation. The shared select/date controls accept optional invalid/error-description props; existing callers keep their defaults.

## Verified evidence

Evidence directory on this machine:

`C:\Users\TrojanNiAnton\Documents\Codex\2026-10-20\continue-the-wolf-forge-spp-project\outputs\team-goals-20261101`

| Check | Result | Evidence |
|---|---|---|
| Goal and existing navigation regressions | 51 tests passed, 10 files | `regression-tests.log` |
| Fresh native PostgreSQL migration and scoped assertions | 39 assertions passed | `native-sql-final.log` |
| Demotion during a blocked milestone update | Before: unauthorized completion; after: refused, no completion | `concurrency-red.log`, `concurrency-final.log`, `native-concurrency.mjs` |
| Nonfinite date rejection | Failed against old implementation, passed after SQL validation | `date-boundary-red.log`, `native-sql-final.log` |
| Next route generation | Passed | `typegen.log` |
| Full repository TypeScript check | Passed, 1536 MiB heap ceiling | `typecheck-final.log` |
| Scoped ESLint | Passed with zero warnings | `lint-final.log` |
| CSS parse and whitespace checks | Passed | Task completion ledger |
| Secret scan, including new source via temporary intent-to-add | Zero findings | `secret-scan.log` |
| Fresh-context whole-change review | All three findings fixed; no remaining code blocker identified | `review.md` |

Key review fixes: recheck authorization/assignee after waits; reject SQL special/noncanonical dates; derive photo-retry error from current route props rather than only initial state. A suspected filename-regex defect was disproved by raw-source inspection and a successful normal photo registration test; no unnecessary regex change was made.

### UI correction checkpoint — 2026-11-01

Seven confirmed issues were corrected locally: dirty-editor discard confirmation; preserved assignee when changing visibility; server filtering before pagination; visible milestone-save feedback; selected-photo preview/removal; associated field errors and focus/scroll to the first invalid field; and navy small-label text. A fresh-context reviewer caught the offscreen validation-focus issue; the final correction removes `preventScroll` from validation focus. Existing default controls and permissions are preserved.

Current evidence is in `C:\Users\TrojanNiAnton\Documents\Codex\2026-10-20\continue-the-wolf-forge-spp-project\outputs\team-goals-ui-fixes-20261101`:

| Check | Current result | Evidence |
|---|---|---|
| Goal/UI/action and existing navigation/control regressions | 84 tests passed, 13 files | `regressions-final.log` |
| Fresh native migration and scoped SQL checks | 45 assertions passed | `sql-green.log` |
| Demotion during blocked milestone update | Refused; zero completions | `concurrency.log` |
| Small label contrast on white | 3.5288558082369037 before; 17.851286825562504 after | `contrast-after.json` |
| Final focused ESLint | Passed with zero warnings, including the validation-focus correction | `lint-final.log` |
| Current source secret scan, including new files | Zero findings across 2,123 files | `secret-scan-final.log` |

The earlier UI-correction full TypeScript run passed before the final small ARIA/focus adjustments; a fresh final full typecheck has not been claimed. No full app build was run. Existing native SQL fixture limitations below still apply. The component regression environment emitted its known unsupported document-navigation warning while all 84 assertions passed; this is not authenticated browser acceptance.

Before screenshots were captured from actual components with offline synthetic data. After capture stopped at the RAM guard (1.96 GiB available versus 2.2 GiB required). The user requested the written comparison first. See `written-before-after.md` in the current evidence directory; no after screenshot, complete responsive check or hosted acceptance is claimed. Neither the full-build 5.5 GiB guard nor the capture guard was bypassed. No application server or provider change was made for these fixes.

The list RPC in the still-unapplied migration now takes optional `p_before uuid` and `p_visibility text`; its grant and maintained type entry match. Invalid filters and mismatched cursor/filter combinations are rejected. Recheck hosted migration state before any separately authorized application.

The native cluster was bound only to `127.0.0.1:55443`, used synthetic data and was stopped after testing (`postgres-stop.log`). The existing portable PostgreSQL binaries were reused; Docker and project app servers were not started.

### Validation limits

Native SQL uses explicitly documented synthetic Auth/Tenant/Storage and fail-fast assertion adapters because this portable package lacks pgTAP/pgcrypto. Those checks do **not** establish full Supabase Auth, PostgREST, pre-request-hook or Storage-policy acceptance. No real Storage upload or authenticated browser test was performed.

Next route type generation is not database type generation. The seven maintained RPC type entries were compared with the native PostgreSQL catalog (`rpc-signatures.txt`); full public-schema generation/comparison remains pending on a separately authorized isolated Supabase backend.

Full build remains deferred: about 3 GiB available, below the existing 5.5 GiB build threshold. No resource guard was bypassed. Browser/mobile/print output is unverified; screenshots from the design phase are references, not runtime evidence.

## Remaining acceptance

1. With at least 5.5 GiB available, run the normal compiled build in this checkout. Keep the existing RAM guard; do not start Docker or close unrelated work.
2. On a separately authorized isolated Supabase backend, apply the migration to the full schema, run test 186 with real pgTAP, compare generated public RPC types, and verify private Storage behavior. Do not point this candidate at production for testing.
3. User manual QA with synthetic Owner, Admin, assigned/unassigned Manager/Staff and Client identities. Try an empty list, long title/description, zero and multiple milestones, create/edit/retry, denied updates, membership/assignment revocation, leadership/shared visibility, valid/invalid/oversized photo and interrupted replacement. Verify failed replacement preserves the old cover.
4. At 320/360/390/430/768/1280/1440 px: cards, detail, editor, select/date menus, keyboard/focus, pending/error states, scroll and loading transitions. Print list and individual detail; verify clean chrome-free layout and loaded images.
5. Only after those gates, review any release separately. This handoff does not authorize a migration on WOAD, a push or deployment.

Useful local commands (existing dependencies only):

```powershell
& 'C:\Program Files\nodejs\node.exe' --max-old-space-size=384 node_modules/next/dist/bin/next typegen
& 'C:\Program Files\nodejs\node.exe' --max-old-space-size=1536 node_modules/typescript/bin/tsc --noEmit --pretty false
& 'C:\Program Files\nodejs\node.exe' --max-old-space-size=512 node_modules/vitest/vitest.mjs run src/tests/team-goals.test.ts src/tests/goal-service.test.ts src/tests/goal-workspace.test.tsx src/tests/goal-photo-route.test.ts src/tests/goal-actions.test.ts src/tests/goal-navigation.test.tsx src/tests/internal-page-skeleton.test.tsx src/tests/internal-shell-navigation.test.tsx src/tests/mobile-navigation.test.tsx src/tests/orders-navigation.test.ts --maxWorkers=1
```

## Operational limitation

An upload whose outcome cannot be confirmed retains its possible new object rather than risking deletion of a committed cover. Actor/Tenant admission limits bound new upload attempts, but abandoned objects can accumulate over time. No janitor/reconciliation job was added; review that separately if actual usage warrants it. No claim of zero ongoing Storage cost is made.

Canonical Obsidian/Security notes stayed read-only under D-319. Proposed steward key: `TEAM-GOALS-LOCAL-20261101`; record local scope, new private tables/RPCs/photo transport, the verified race fix, evidence and the remaining build/Supabase/browser gates. Do not mark this live.
