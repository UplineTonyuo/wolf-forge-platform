# Goals annotation fixes — local candidate

Branch: `codex/goals-polish-20261101`, based on `42144a5194b9c767cdf15781bbc09c5eed6730be` (merged Goals release). This section records the pre-release local checkpoint: no push, deployment, hosted migration or customer data writes had been performed. The user authorized the WOAD rollout on 2026-11-02; final release receipts belong in `outputs/goals-polish-release-20261102`.

## Requested result

1. Remove the page's TEAM eyebrow.
2. Keep the calendar visible inside the goal editor.
3. Show the responsible person's existing profile photo in the picker, cards and detail overview, with the standard person fallback if no photo is available.
4. Remove the redundant visibility controls. All active internal members of the same Tenant can view all Goals. Owner/Admin management and assigned Manager/Staff milestone editing remain unchanged. Clients and other Tenants remain excluded.
5. Remove the empty-state target icon.
6. Recommend **1080 × 1080 px** Canva uploads. Cards, detail and selected-file previews use square frames with `object-fit: contain`; portrait/landscape images remain accepted and whole. Existing 2 MB JPEG/PNG/WebP limits remain.
7. Keep person photos beside names on cards.

## Reproduced cause and correction

The date popover was 320px wide, right-aligned to a narrow column inside an overflow-scrolling dialog. Its left edge and sometimes bottom controls were outside that dialog's visible area. The Goals editor now uses the house DatePicker's explicit inline placement, letting it participate in dialog scrolling. Other DatePicker callers keep their existing above/below placement. Keyboard date selection, month navigation, Escape and focus return were checked.

Goal images used a 16:9 frame with `object-fit: cover`, cropping portrait images. Frames are now square and contain the full image; detail size is bounded to 540px and responsive. A review also caught the selected-file preview's remaining cover rule; that rule was corrected before final verification.

## Database change, not applied to hosted databases

New CLI-generated migration: `supabase/migrations/20261101155040_team_goals_shared_photos.sql`.

- Changes legacy leadership-only Goals to shared and bumps their revision. IDs, authors, descriptions, photos and milestones are retained.
- Adds a shared-only constraint and rejects new leadership-only writes at both app and RPC validation boundaries.
- Adds existing profile avatar URLs to goal and assignment-roster JSON.
- Replaces three existing function definitions, retaining their EXECUTE grants. No new roles, table grants, Storage policies or public bucket are introduced.
- The original applied `20261031185018_team_goals.sql` remains unchanged.

Older open editors that try to save a leadership-only payload will be refused and must reload after release. Former leadership-only Goals intentionally become visible to active internal colleagues on migration; this is the requested policy change, not merely hiding a tab.

## Fresh verification

- **39 focused unit/component tests passed** in eight files.
- **Full TypeScript check passed**, `tsc --noEmit --incremental false`, bounded to a 1536 MiB Node heap.
- **Scoped ESLint, diff whitespace and CSS Modules pure-mode checks passed.**
- **Secret scan: zero findings across 2,125 candidate files**, including both new untracked source files using a separate temporary index. The working index was not changed.
- **47 native PostgreSQL assertions passed**: internal roles, client/foreign-Tenant denial, current membership revocation, raw table denial, assignment write limits, stale revisions, pagination and photo context checks.
- **Five migration upgrade checks passed**: historical content/completion preservation, conversion to shared, revision change, Staff read of a formerly leadership-only goal, and owner avatar propagation.
- **56 real rendered-component browser checks passed** at 320/360/390/430/768/1280/1440px. Checked calendar clipping, Escape/focus, keyboard selection, avatar picker visibility, selected-photo preview, full portrait display and horizontal overflow. Zero page errors. Before the fix, 14 of the original 28 geometry/image checks failed (seven calendar and seven image cases).
- Independent read-only review found the preview crop; it was fixed. No other concrete access-control or correctness blocker was found.

The browser fixtures use actual TSX/CSS with synthetic people/images and stubbed actions; they do not prove a live upload or authenticated full-app session. Native PostgreSQL uses documented synthetic Supabase seams; this is not full hosted Supabase Auth/Storage/RLS acceptance.

## Remaining release gates

- Full Next.js build was not started: last check was about 3.26 GiB available, below the established 5.5 GiB safe-build guard.
- Full isolated Supabase acceptance, hosted migration, CI and WOAD rollout remain pending. No deployment is claimed.
- Browser and local PostgreSQL were stopped; owned ports 3092 and 55444 were verified closed. Docker, RojanCRM, William's account and client records were not touched.

## Evidence and reproduction

Output folder:
`C:\Users\TrojanNiAnton\Documents\Codex\2026-10-20\continue-the-wolf-forge-spp-project\outputs\goals-polish-20261101`

Evidence: `before-checks.json`, `after-checks.json`, `unit-final.log`, `sql-checks.log`, `upgrade-checks.json`, `typecheck-final.log`, `lint-final.log`, `css-check.log`, `secret-scan-all-candidate.log`, and the before/after PNGs. `capture.mjs` renders the actual components without a backend or external requests; `upgrade.mjs` accepts only the fixed owned local test cluster. Historical before-source copies are retained under this task's output directory.

Commands (run from this worktree):

```powershell
node --max-old-space-size=1536 node_modules/typescript/bin/tsc --noEmit --incremental false
node --max-old-space-size=384 node_modules/vitest/vitest.mjs run src/tests/goal-people.test.tsx src/tests/goal-ui-fixes.test.tsx src/tests/goal-workspace.test.tsx src/tests/goal-service.test.ts src/tests/goal-photo-route.test.ts src/tests/goal-navigation.test.tsx src/tests/goal-actions.test.ts src/tests/team-goals.test.ts --maxWorkers=1 --reporter=dot
node --max-old-space-size=384 ..\..\outputs\goals-polish-20261101\capture.mjs after
```

Canonical Obsidian notes stayed read-only under D-319. A proposed narrow memory entry is saved beside the output report for the designated steward; no synchronization is claimed.
