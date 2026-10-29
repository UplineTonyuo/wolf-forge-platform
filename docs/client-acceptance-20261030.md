# Client workspace acceptance changes

Branch: `codex/client-acceptance-20261030`, based on `5813e73bc721d043909735f5d10e3a264727e6fe`.

## Requested behavior

| Area | Change |
| --- | --- |
| Client Projects | Six plain tabs: Pending, Working, Complete, Canceled, Waiting reply, All. Pending includes pending/submitted/pending_update. Five projects per page, after filtering. Filters do not change status. |
| Pending intake | A pending project with an authorized incomplete required intake links directly to that assignment. Missing Forms access cannot hide authorized Projects. |
| Started orders | Hide the completed Start order announcement; existing start/required-intake enforcement remains. |
| Composer | Client counter and shortcut hints removed; 136px minimum editor height, right-aligned actions, responsive recording footer, circular avatars. Keyboard shortcut and length validation remain. |
| Drafts | Remove only the default device-storage explanation. Keep restoring, saving, saved, discard and failure behavior. |
| Audio | One navy/gold player, play/pause and accessible seek control. The bars are decorative waveform-style graphics, not measured audio amplitudes. Remove duplicate audio-only bubble and preserve messages with accompanying text. No added media downloads or decoding. |
| Store | Purchase button says “Purchase”; original confirmation, amount and idempotent transaction flow remain. |
| Wallet | All/Money in/Money out filters, direction icons and transaction disclosure with original reason/balance. No financial writes. |
| Form PDFs | Authorized project reference and title precede the form title. Box the original agreement; show original drawn ink, consent and signing time below it. Preserve historical evidence and exclude secrets. |
| Invoice printing | A4 print styles, clear metadata and totals, expanded original item scope, app controls hidden. Browser-owned date/URL print headers remain a browser setting. |
| Manager Projects | All projects/tasks within the current workspace; default Everyone with optional Assigned to me, status/assignment/task controls. Explicit permission denials, module state, archived membership, other workspaces and non-Project permissions remain enforced. |

No live calls changes; draft PR #76 remains separate. No UI redesign or new dependencies.

## Database changes and compatibility

1. `20261030010000_manager_project_scope.sql` changes only the three existing Project scope/archive functions. Exact source fingerprints fail closed on drift, and readback verifies owners/ACLs. Manager scope is inside the existing internal-account, published-module, permission and workspace checks. An absent Manager archive preset is added; an existing false preset is preserved. No `client_private.read` grant.
2. `20261030011000_form_pdf_project_context.sql` adds the explicit `(uuid, boolean)` overload. It first calls the existing authorized, rate-limited, secret-filtered receipt function. The original one-argument overload remains unchanged for already-open app versions. Project metadata requires current Project access. The new app supplies `p_include_project: true`.

New task server actions use existing authorized RPCs, verified actor context and matching parent order. Assignment needs both edit and assign. Tickets denied at the module/capability boundary do not mount an enabled composer.

## Local verification

- Next route generation and full TypeScript compile passed.
- Focused regression run covers project tabs/pagination, intake shortcuts, task action capabilities, wallet filtering, original PDF evidence, PDF route error/quotas, Projects desktop/mobile filters, private voice playback, conversation ownership and purchase confirmation/retry.
- Existing Playwright and Chrome ran an isolated synthetic `file://` component harness at 320/360/390/430/768/1280/1440px. No HTTP(S) requests, real microphone, login, provider or customer data. Tested actual filter, wallet, composer/recording, avatar, task rename, form draft-save and keyboard audio controls.
- Real form renderer generated a three-page synthetic A4 PDF; all pages were rendered with Poppler and inspected. Inspection found and fixed a black signature background. Last agreement clause, project number, ink and signing metadata remain visible.
- Invoice fixture uses representative route markup, real print CSS and the actual item-scope component. It renders to one A4 page. This is not authenticated invoice-route acceptance.

Evidence on the task machine: `outputs/client-acceptance-20261030/visual/evidence.json`, screenshots and invoice fixture; `outputs/client-acceptance-20261030/pdf/`; and `outputs/client-acceptance-{tests,typecheck,lint}-20261030.*`.

Commands from this worktree:

```powershell
node --max-old-space-size=2048 node_modules/typescript/bin/tsc --noEmit
node --max-old-space-size=256 node_modules/vitest/vitest.mjs run src/tests/client-projects-page.test.tsx src/tests/client-project-status-filters.test.tsx src/tests/client-order-start.test.tsx src/tests/project-task-actions.test.ts src/tests/wallet-history.test.tsx src/tests/form-pdf.test.ts src/tests/form-pdf-route.test.ts src/tests/projects-workspace.test.tsx src/tests/projects-filter-ux.test.tsx src/tests/voice-audio-player.test.tsx src/tests/tickets-conversation-polish.test.tsx src/tests/ticket-conversation-ownership.test.tsx src/tests/ticket-conversation-layout.test.ts src/tests/invoice-ui-consistency.test.tsx src/tests/invoice-visibility-boundary.test.tsx src/tests/store-service-purchase.test.tsx --maxWorkers=1 --no-file-parallelism
npm run security:secrets
```

The full build and real database tests run in existing GitHub Actions on a disposable Linux runner, not local Docker or a hosted customer database. The database job applies the entire migration chain, runs pgTAP including Manager scope and PDF evidence, and the guarded real PostgREST support probe. The new PDF overload is exercised with the bound support identity, project-access revocation, other clients/workspaces, missing request hook, Forms denial and explicit support exit. Quotas and original receipt compatibility remain tested.

## Rollout gate

Not deployed and migrations not applied to WOAD. A draft PR/CI run is verification, not deployment approval.

Before any separately approved rollout:

1. Require all CI jobs to pass on the reviewed commit; inspect the SQL and actual build results.
2. Back up production database and record current function bodies, owners/ACLs and Manager preset before applying these two migrations. Stop on drift or any failed gate.
3. Apply migrations in order, verify exact readback/grants and preserve existing answers/signatures. Do not modify customer profiles, roles, order states or financial records for QA.
4. Build against the updated schema, review the candidate, then switch WOAD only under explicit rollout approval.
5. Use a dedicated synthetic team/client account for manual desktop/mobile acceptance: six tabs/five rows; missing intake shortcut; draft save/reopen/errors; recording/cancel/play/seek; actual form/invoice downloads; Manager Everyone/Assigned to me and status/task controls; denied permissions; other-workspace refusal.
6. Roll back the app alias for an app defect. For a database authorization defect, disable the new path and use a reviewed forward correction or the captured previous function/preset definitions; do not restore production data destructively.

Local RojanCRM, Docker, customer sessions, William's work and production data were not operated on. Real-device media and signed-in WOAD acceptance remain manual rollout checks.
