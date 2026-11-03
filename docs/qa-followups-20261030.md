# WOAD QA follow-ups — local implementation

Branch `codex/woad-qa-followups-20261030`, based on clean `88600b2259f0277716d681a3691da655d29c8c56` (PR90). This is implementation evidence, not production acceptance or rollout authorization.

The complete owner handoff is `outputs/woad-qa-followups-20261030/handoff-prompt.txt` in the enclosing Codex workspace. The configured Global OS and canonical Wolf Forge memory were read; the separate configured White-Label repository was not edited. PR90/live deployment records remain historical evidence. WL-2.34, PR76 and DoW lanes were excluded. Canonical notes remain read-only under D-319; the proposal below is for the single steward.

Startup synchronization: Global OS resolved to `C:\Users\TrojanNiAnton\Downloads\Anthony OS-20261009T175758Z-1-001\Anthony OS\10 Templates\Coding Agent OS\CODING AGENT OPERATING SYSTEM.md`; canonical project memory resolved to `C:\Users\TrojanNiAnton\Downloads\Anthony OS-20261009T175758Z-1-001\Anthony OS\02 Projects\Wolf Forge Platform\AI Memory`. Initial branch/HEAD/status matched the handoff exactly. Memory's PR90 checkpoint matched the source baseline, but the recorded Pending intake shortcut was ineffective for clients because the assignment projection redacted its Project ID. The unfinished phase was these five QA follow-ups and manual acceptance. RAM and unavailable full isolated SQL verification are the outstanding validation risks; the authorized next action is local verification/commit and owner-led QA, not rollout.

## Findings and changes

| Follow-up | Verified source cause | Implemented behavior |
| --- | --- | --- |
| Required intake | `app_list_assigned_forms` used an internal-only Project predicate for the client assignment's `order_id`, so Pending could not match the required form. Detail UI hid forms until a start request. Purchase gate creation also returned early on missing UI grants. | The RPC exposes Project identity only under current client/company/Tenant/Project authority. Incomplete required forms appear before Start order; all must complete. Empty/malformed start requirements fail closed. Every frozen requirement remains visible, including unavailable ones; completion reflects matching submitted evidence. New eligible purchases persist gates despite a missing Forms UI grant. Existing server start enforcement, frozen versions and intentionally ungated services remain. |
| Shared header | Hover/focus changed rail widths, moving Search and adjacent controls. Unauthorized Quick Action wrappers occupied empty gaps; tablet Profile sizing differed from desktop. | Reserve secondary-control width while preserving its fade, omit unauthorized Quick Action slots, remove an empty secondary rail and align the tablet Profile slot. No control enlargement or route-specific header rule. |
| Repeated Inbox | Removing the page scrollbar changed viewport width; focus restoration could scroll the page. Independent overflow snapshots conflicted when closing/opening modals overlapped. | Stable root scrollbar gutter, scroll-free focus return, and one counted body lock for Inbox, Quick Action and the shared portal dialog. Preserve the original trigger through rapid reopen. Existing draft state, single drawer/sync mount, Escape, trapping and exit animation remain. |
| Tasks/progress | The supplied screenshot showed an empty title, which correctly disables Add task; it did not establish a nonblank-create database defect. Source/unit reproduction found whitespace event submissions, overlapping submits and unhandled thrown failures. Only internal pages were explicitly invalidated. | Trim/validate titles, guard in-flight saves, retain title/request ID on errors and show a safe retry message. Add a visible title label and useful empty state. Successful task mutations invalidate internal and client progress surfaces. Reuse the existing task RPCs and count-only client progress; no task templates or private task content in the portal. |
| Manager contacts | UI loading/display used `privateManage`; raw contact SELECT is restricted by existing RLS. | Add `clients.contact_read` and a four-field primary-contact RPC. Default allow Owner/Admin/Manager, deny other roles. Recheck internal actor, active profile, module, view/read permissions and Tenant/company scope. Manager email is plain read-only text. Keep raw-table RLS, editing, wallets, private management and support-session authority unchanged. |

The referenced customer order was not read or mutated through a live backend. Its actual legacy/gated classification is unverified here; seeing the old Start order button did not prove a persisted bypass.

## Database changes and compatibility

1. `20261030020000_qa_intake_assignment_projection.sql` narrowly replaces three existing function bodies, preserving owners/ACLs and failing on unexpected source anchors. It accepts LF/CRLF source. No assignment/version replacement, historical order backfill, rollout-flag change or financial mutation.
2. `20261030021000_manager_primary_contact_read.sql` adds the permission/defaults and `app_get_primary_contact_summary(uuid)`. Only authenticated callers can execute it; role, permission and scope checks remain inside the RPC. The projection returns only name, email, phone and job title. No contact editing/private-management/impersonation grant is added.

The CLI created the migration files; their timestamps were moved after PR90's already-scheduled migrations so later application does not require inserting earlier ledger versions. Neither migration was applied to a hosted project. The generated TypeScript contract contains the narrow new RPC declaration; full schema regeneration remains a release check.

Before a separately approved rollout: pass the full isolated Supabase migration/pgTAP suite and full typecheck/build on this exact tree, review/backup the existing function sources/ACLs, apply these migrations in order, verify source/ACL/default readback, then release the app. Keep PR90 as the current live checkpoint until actual merge/release verification.

## Verification

Fresh local evidence is under `outputs/woad-qa-followups-20261030/` in the enclosing Codex workspace.

- Focused unit/component/action checks passed. Includes Manager support-entry denial, task failure/retry/double-submit, required intake/server refresh, repeated Inbox open/Escape/rapid reopen/unmount, counted overlapping locks and header badge boundaries.
- Final full suite: **3,888/3,888 tests passed across 316 files**, zero failures. Durable `vitest-final.json` and `vitest-exit.json` confirm success/exit 0. The source assertions now require reserved header geometry. The earlier agent-server-interrupted run is not counted as a pass.
- Final native PostgreSQL 17 persistence smoke: **15 checks passed**. Reproduced original Project-ID redaction before migration, verified repaired client links and deny redaction, two frozen requirements, missing-grant gate creation, pending until all evidence, unavailable requirement retention and generic labels for mismatched bindings, one persisted start after retries, legacy/no-intake compatibility, task idempotency and completion/reopen client counts, contact projection/denials and ACLs. Disposable loopback clusters were stopped after every attempt; fresh final readback confirmed no postmaster PID file.
- This native smoke uses synthetic schema/auth/lifecycle prerequisites and paid receipt/submission fixtures. It is **not** a full Supabase/Auth/RLS/PostgREST pass, nor actual purchase/submit-RPC acceptance. Those real-RPC regressions are committed in SQL167/178/180 but were not executed here. No Docker was started.
- Next route type generation passed. Full TypeScript attempts exhausted 512 MiB and 1 GiB heap caps; no semantic typecheck pass is claimed. More RAM is required for the established 2 GiB command.
- Full ESLint (`--max-warnings=0`) passed after correcting a React immutability diagnostic in the assignment-error path.
- Final tracked secret scan: **0 findings across 2,044 files**; whitespace checks passed. No dependency or startup-policy changes.
- Full build withheld below the existing 5.5 GiB free-RAM threshold. No RAM guard was weakened and no apps were closed.
- No browser/dev-server/computer-use automation, actual-device media, hosted DB/CI, production transaction, email, push or provider operation. Owner-reported prior QA remains historical/user-reported.

Commands used:

```text
node --max-old-space-size=256 node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
node --max-old-space-size=256 node_modules/next/dist/bin/next typegen
node --max-old-space-size=512 node_modules/typescript/bin/tsc --noEmit
node --max-old-space-size=1024 node_modules/typescript/bin/tsc --noEmit
node --max-old-space-size=512 node_modules/eslint/bin/eslint.js . --max-warnings=0
node --max-old-space-size=128 ../../outputs/woad-qa-followups-20261030/native-smoke.mjs
node --max-old-space-size=256 --import tsx scripts/security/scan-secrets.ts
git diff --check
```

## Manual acceptance checklist

Use only a separately verified isolated backend and synthetic accounts. Check 320/360/390/430/768px plus 1280/1440px, including long content, opened menus and sticky actions.

- Pending: first authorized incomplete intake link opens its exact frozen assignment; complete all required forms before Start. Confirm persisted status, then retry/reopen. Repeat for an unavailable form, denied Forms access, completed forms and an intentionally ungated service.
- Owner/Admin/Manager/Staff: Search, Notifications and Profile align on list/detail pages, especially Manager Project details. Hover/focus/resize should not shift adjacent controls.
- On a scrolled long page, open/close Inbox repeatedly, switch to Quick Action/dialogs and reopen during the outro. Check stable background position, one overlay, Escape, focus return, drafts, scrolling and reduced motion.
- Manager: create a nonblank task on an authorized project, force failure/retry/double submit, complete and reopen. Fresh-read the client's progress; ensure no private task title reaches the client. Check foreign-project/Tenant and explicit-deny paths.
- Manager: read existing primary name/email/phone/title and truthful missing values. Confirm no editing/private-management/secret/billing/role/support-entry capability appears. Owner/Admin support entry remains available under its existing checks; Manager/Staff/Client/other-Tenant calls remain denied.

## Memory-steward proposal — do not allocate IDs here

After reviewing the final commit and verification evidence, the single steward may apply these narrowly to the existing canonical notes:

- **Current State:** local QA follow-ups implemented on this branch; record the final commit and exact fresh test/native/lint results, TypeScript/build/full-Supabase/manual-QA gates and no rollout. Do not replace PR90's live checkpoint with local work.
- **Implementation Log:** one timestamped Codex entry naming intake projection/read guards, counted modal locks/header slots, task retry/progress invalidation and four-field Manager contact read, migrations and evidence/limits. No raw terminal dump.
- **Decisions:** owner-authorized Manager primary-contact read is separate from private management and impersonation; a new capability is bound to existing active workspace authority. Steward allocates any ID only at write time.
- **Known Issues:** these verified source defects are corrected locally; production/manual acceptance remains pending. Do not mark a production issue resolved from unit/native fixtures alone.
- **Architecture Map:** describe the narrow contact RPC/capability and repaired assignment-to-Project projection; retain the authoritative aggregate progress and frozen start-gate model.
- **Security 02/04/08/14/16/17:** record the four-field read boundary, unchanged table RLS/private/support grants, active-profile/permission/Tenant tests and the distinction between native smoke and pending full isolated Supabase coverage. Allocate control IDs/status only through the steward; nothing is Live from this lane.

If a historical order needs a gate, first prepare a read-only inventory of exact pending paid orders, service mappings, original assignments/frozen versions, client bindings and current gate rows. Propose an exact bounded set and recovery/readback plan. Obtain separate backfill approval; never fabricate forms, replace frozen assignments or infer eligibility from a missing UI link.

Skills used: systematic debugging, Ponytail, test-driven development, UI/UX Pro Max, Impeccable (existing-layout guidance), security-and-hardening, Supabase, React best-practices review and verification-before-completion. Existing Wolf Forge design and the owner's safety instructions take precedence. No skill/tool installation or external model/agent delegation.
