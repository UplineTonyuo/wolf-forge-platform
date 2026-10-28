# Order Details implementation handoff

Task: `outputs/claude-order-handoffs-20261028/order-details.md` (read from the parent project outputs folder).
Agent: Codex. Verified 2026-10-28, Asia/Singapore.
Branch: `codex/woad-order-details-20261028`. Base: `99a4cd99cfc7ab9919f3e83322b71bfded076cec`.
The focused implementation checkpoint is the commit containing this handoff; obtain its full identity with `git log -1 --format=%H -- docs/order-details-20261028.md`.

## Implemented behavior and files

- `src/app/(internal)/orders/[orderId]/page.tsx` mounts the always-present private team note and authorized submitted forms above the existing conversation/tasks. `layout.tsx` marks only the Order frame and makes the rail keyboard-scrollable; existing rail content and mobile disclosure remain intact.
- `src/components/projects/order-submitted-forms.tsx` reuses `listSubmissions(undefined, orderId)` and `getSubmission(id)`, verifies exact Order/Company/Form/version identity, groups latest responses per Form, and exposes all authorized earlier responses. Authorized assignment-history titles are optional; unavailable metadata falls back to a numbered Form heading. No published definitions are read or modified. Frozen submitted labels/order/values remain authoritative.
- `src/components/projects/order-response.tsx` and `order-responses.module.css` provide response date/revision/field-count summaries, intrinsic-height/opacity disclosure, native keyboard buttons, `aria-expanded`/`aria-controls`, inert folded content, and reduced-motion CSS. Long forms start folded; short latest responses start expanded. Stable submission keys and mounted content preserve disclosure state through unrelated refreshes. Every manual PDF action uses that response's immutable ID, outside the folded answer body.
- `src/components/forms/submitted-answer.tsx`, `submitted-answer.module.css`, and `src/lib/forms/submitted-fields.ts` render readable primitives, selections, blanks, links, authorized files, validated signature ink and historical typed signatures. Unsupported structured payloads have a neutral unavailable state rather than raw JSON. Secret/password/hidden and non-response fields are removed before Order data reaches the client renderer. Supplied HTML/SVG is never executed. Server-saved signing dates are shown when valid.
- `src/components/forms/submission-detail.tsx` reuses the same read-only renderer while retaining the existing append-only correction and PDF interfaces. `submitted-file.tsx` waits for authorized metadata before showing a download link, catches rejected requests and discards stale file results.
- `src/components/projects/order-team-note.tsx` and `order-team-note.module.css` implement Add/Edit/Save/Cancel, pending/saved/error feedback, focus return, draft retention on save failure, and stale-result suppression on identity/edit-authority changes. Unrelated refreshes preserve the draft.
- `src/app/actions/orders.ts` adds `updateOrderNoteAction`: fresh internal context/module/edit checks, `{ notes }` only through existing `OrderService.update`/`app_update_order`, whitespace-to-null clearing, safe errors, narrow return value, and Order-path revalidation. No title/service/status/assignment fields enter the patch. Existing database tenant/resource/edit enforcement and content-free audit behavior remain authoritative.
- `src/components/projects/project-detail.module.css` replaces the desktop workspace's non-scrolling `overflow:hidden` ancestor with `overflow:clip` only while an Order frame is present. This preserves the rounded shell without capturing sticky scrolling. The desktop rail has a viewport-bounded, keyboard-scrollable overflow area. At <=900px it retains normal-flow/mobile disclosure behavior.
- Tests: `src/tests/order-response.test.tsx`, `order-submitted-forms.test.tsx`, `order-note-action.test.ts`, `order-team-note.test.tsx`, `submitted-file.test.tsx`, `submission-detail-answers.test.tsx`, and `fixtures/order-response.ts`.

## Fresh verification

- Offline locked dependency setup: `npm.cmd ci --ignore-scripts --offline --no-audit --no-fund`; 590 packages. Inspected lockfile v3 and existing CI's scripts-disabled policy first. No lockfile/dependency manifest changes or lifecycle scripts.
- `next typegen --webpack`: passed; generated files remain in this worktree and tracked `next-env.d.ts` is unchanged. No server or production build started.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- Scoped ESLint on all changed/new TypeScript files: passed with zero warnings.
- Focused Vitest: **11 files, 61 tests passed**, one worker. Includes the six new suites plus existing `drawn-signature`, `download-form-pdf`, `form-pdf-route`, `order-details-rail-toggle`, and `projects-module-actions` suites.
- Covered: multiple Forms/revisions and exact submission IDs; fresh scope mismatch denial; field order/redaction; safe links and signature parsing; authorized file names and denied/stale metadata; disclosure ARIA/inert/state retention and reduced-motion source; notes-only payload/edit/module denial, null clearing, pending/failure/cancel/retry, stale responses; client projection secrecy; shared submission correction compatibility; existing PDF expiry/MIME/failure/retry and private route contract.
- `git diff --check`: passed. Source review confirms no notification, purchase/start-gate, price/role, migration, dependency lock, Gmail or call implementation changes.

## Manual QA still required

No browser automation, visual inspection, build, SQL suite, database/runtime authorization test, or real download was run. No isolated Docker-free backend was configured; no environment credentials were read/copied. Unit mocks and source assertions do not certify database deployment or real cross-Tenant enforcement. Existing SQL contracts were inspected, not executed.

1. At **320, 360, 390, 430, 768, 1280 and 1440px**, inspect synthetic Order details with mixed answers, a long agreement/URL, multiple Forms/revisions, files, drawn and historical typed signatures. Check readable wrapping and opened menus without horizontal overflow.
2. Tab through Show/Hide responses and history; activate with Enter/Space; verify focus, reversible smooth height/opacity and reduced-motion behavior. Fold a long response, refresh unrelated content and confirm state remains. Confirm a manual PDF remains reachable while the answer body is folded and each revision downloads its own saved receipt.
3. On desktop, scroll the main conversation/responses and confirm the rail sticks; use a short viewport and keyboard-scroll a tall rail. Check rounded chrome and overlays. On phones/tablets, verify the existing Details disclosure remains normal flow and does not overlap composer/actions. Check another route's shell remains unchanged.
4. Using legitimate isolated identities, save/edit/cancel/clear the private note; simulate denied and failed saves, inspect retained drafts and pending/saved feedback. Verify unrelated Order fields remain unchanged and read-only colleagues cannot save. Recheck lost access and late responses after switching Orders/Tenants.
5. With an authorized synthetic backend, download actual files and PDFs, then test denied/expired sessions. Verify notes/credentials are absent from client fetches, PDFs, notifications and logs. Relevant SQL suites 016/132/166/168 remain for a separately verified isolated backend.

## Design and scope

Preserved Wolf Forge navy/gold, Inter/Sora, shared buttons, existing field/rail surfaces and motion easing. Reading this as an internal operations detail screen for staff: ENERGY 1 / RHYTHM 1 / MOTION 2. Field/value rows make frozen answers scannable; the note precedes them for team context; motion explains disclosure; the existing gold note treatment distinguishes private working text. Used installed UI/UX Pro Max guidance, project Impeccable, TasteSkill app-screen guidance, AntiSlop During and Ponytail. Security and React guidance informed the narrow mutation, client projection, parallel authorized reads and stale-response guards. Python design search and browser/visual skill gates were not run; user scope prohibits tool installation and browser automation. No design/browser PASS is claimed.

No Docker, server, app/process stopping, production/hosted data operation, customer test, provider delivery, merge, push or deployment. No new schema. Unrelated `.codex/config.toml`, created during the session, was preserved and excluded from the task commit.

## Proposed canonical/security updates for the coordinator

Canonical memory remains the configured Anthony OS `02 Projects/Wolf Forge Platform/AI Memory`; all vault notes stayed read-only, as this task requires. No `.ai-memory`, synchronization hook or Raw write was created.

- Current State: replace only the Order-details assignment's awaiting-implementation statement with this local source/checkpoint and fresh verification. Keep notification assignment and live release facts separate; visual/runtime acceptance is pending.
- Implementation Log: append this timestamp, agent/task, key paths, exact local checkpoint, behavior, 61-test/type/lint results, manual/database limitations and next action.
- Architecture Map: document grouped read-only Order submission history plus the shared answer renderer and notes-only action if considered a material flow change. No new product decision, schema or permission grant was introduced.
- Security topics 02 Roles & Authorization, 04 RPC & SECURITY DEFINER, 08 Client Data Isolation and 14 Security Testing: record reuse of current Projects/Form authorization, pre-client credential redaction, notes-only payload and scoped client-safe result, with mocked/source test evidence clearly distinguished from unrun SQL/runtime checks. Registry/control statuses should remain unchanged unless separately verified evidence warrants an update. No verified new unresolved authorization gap was found by this focused work.

Next: user manual QA, coordinator integration/diff review with the separately owned notifications branch, then separately authorized CI/build and isolated workflow/database checks. Review the exact candidate before any rollout. A later production proposal should deploy only the reviewed integration candidate after acceptance; this task needs no migration. Production remains unchanged until separately approved.
