# Published tenant branding consumer handoff

Codex, 2026-10-20. Published-branding consumer source is verified for a local checkpoint under the user's explicit completion/tests/commit request. Runtime acceptance remains with Integration. The October 16 and October 13 records below are historical; their unexecuted-test and pending-binding statements do not describe the current source.

## October 20 source checkpoint

Starting worktree: `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-WL-Branding-20261013`, branch `feat/wl-branding-20261013`, HEAD `c0e524bc84a0e21b9c9350e674f66eb7389b2c4c`. Read the consumer and coordinator handoffs and actual source before edits. All 22 preexisting modified/untracked files were copied byte-for-byte and SHA256 verified in `C:/Temp/wolf-forge-branding-checkpoint-20261020/before`; `preservation.json` records their starting state. No existing file was discarded. The prepared layout/service/GET/provider/portal bindings were already implemented and required no further production-code changes. Two unsupported Testing Library `exact` options in `tenant-branding-shells.test.tsx` were removed; role-name matching is exact by default.

Dependency reconciliation against `5e1d19422bbf78589ad7cbc1a5a2cc6f21c37cc6`:

- Prepared Publication domain, repository and service bytes exactly equal the baseline's blobs. All four additive RPC declaration bodies match. These three untracked producer files and the modified generated `database.types.ts` remain intact and are excluded from the Branding commit. The consumer commit depends on the Publication implementation already in functional integration; it is not a self-contained replacement for that baseline.
- The four original Auth commits and their Branding cherry-picks listed below have identical stable patch IDs. `next-server.ts`, `identity-lookup.ts` and `identity-failure-response.ts` match integration after CRLF/LF normalization. No additional Auth cherry-pick, resolver edit or shared-file replacement was performed. Integrate only the new consumer checkpoint; do not reimport the equivalent Auth ancestors.
- The touched layouts and shared components have identical pre-Branding content in both branches. The only preexisting difference in the touched CSS is Branding's predecessor `body` minimum width. The Branding patch appends tenant selectors only; preserve integration's existing removal of that minimum width when applying it.

Fresh source verification:

- Initial four Branding suites: 70/70 PASS. Initial TypeScript exposed two test-option errors plus missing generated Next `PageProps`; the test options were corrected and installed Next documentation was followed to run `node node_modules/next/dist/bin/next typegen`, without a build/server/backend operation. `next-env.d.ts` remained unchanged and generated `.next` output is excluded.
- Final focused and adjacent suites: 124/124 PASS in eight files, one worker: the four `tenant-branding*` suites, `internal-shell-navigation.test.tsx`, `client-portal-shell.test.ts`, `frontend-shell.test.ts`, `mobile-filter-sheet.test.tsx`. Existing jsdom navigation emits a non-failing "Not implemented: navigation to another Document" diagnostic.
- Final `npm.cmd run typecheck -- --incremental false`: PASS. Affected-file ESLint: PASS on all 16 affected TypeScript/TSX files with `--max-warnings=0`. CSS was inspected through the diff and consumer tests; no CSS-linter pass is claimed. `git diff --cached --check`: PASS. `npm.cmd run security:secrets` after explicit staging: zero findings across 1709 tracked files, including every new consumer/test/handoff file. No source-check failure remains.
- Consumer-only staged patch `git apply --check` against the existing functional integration checkout at `5e1d194`: PASS, without applying it or changing that worktree. Integration's preexisting `next-env.d.ts` modification remains untouched. This is patch applicability, not a combined build or runtime pass.

Exact checkpoint path set (18 files):

```text
docs/wl-branding-consumer-handoff-20261013.md
src/app/(internal)/layout.tsx
src/app/account/layout.tsx
src/app/api/white-label/runtime/route.ts
src/app/globals.css
src/components/account/client-account-shell.tsx
src/components/account/client-portal-sidebar.tsx
src/components/account/ui/portal-dialog.tsx
src/components/shell/internal-shell.tsx
src/components/shell/tenant-branding-provider.tsx
src/components/shell/tenant-branding.ts
src/components/shell/workspace-command-bar.tsx
src/components/shell/workspace-quick-action.tsx
src/components/ui/mobile-filter-sheet.tsx
src/tests/tenant-branding-provider.test.tsx
src/tests/tenant-branding-runtime.test.ts
src/tests/tenant-branding-shells.test.tsx
src/tests/tenant-branding.test.ts
```

These tests call the route/layouts with mocked identity and RPC responses and exercise shell/provider behavior in jsdom. They establish source checks only. No build, live API, database, browser, normal-login, actual publish observation or seven-width runtime acceptance was performed. The existing Integration Owner `01a13515-4a2d-7a30-a4bb-65b554932bc9` retains build/backend/combined acceptance ownership. Its retained backend has no reuse grant and the earlier credential incident remains unresolved by this task. No live owner acknowledgement or new runtime grant is claimed; use this checkpoint and the remaining-runtime checklist below for its separately scheduled composed validation. The current direct user request authorizes focused source checks and this local checkpoint, superseding the historical focused-slot hold for this task only.

Canonical vault/Security notes remain read-only and unchanged under the existing allocation. No PWA work, client-data migration, remote changes, dependency installation, push, deployment or repository archival was performed.

## October 16 continuation

User authorized completing the existing prepared work with the minimum necessary change. All fifteen prepared paths matched the resolved ownership receipt before editing. Their exact original bytes are preserved outside the repository in `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Studio-Release-20261014-Validation/functional-integration-20261015/branding-prepared-source-20261016`. No dirty source was discarded and the index remains empty.

Endpoint decision: the prepared provider requires the approved same-origin GET for visible 30-second observations and coalesced focus/resume reads. Both layouts supply only an initial snapshot; Next layouts are cached across navigation. Existing internal header refresh reads notifications only, and the client shell has no branding refresh. Whole-router refresh is not the agreed brand-only observation and may disturb business-state refresh behavior. Frozen v1.0 requires the runtime RPC/service and union, not an HTTP GET; the separate approved Branding contract handoff explicitly allocates and requires this route. No frozen contract change was made.

Dependency transfer followed `branding-continuation.json`:

- Producer source `5e1d19422bbf78589ad7cbc1a5a2cc6f21c37cc6`: exact domain/repository/service blobs and only four additive RPC declarations. SHA256: domain `4d92ca06e0c18a82ae32d5b786fd4f85ebc137374a799f4a4685e720697ef211`; repository `d1928f0edce7ce81532b9799698a84c88351eccb475fbc8fb36fee4cc41956c1`; service `d990d9e941aa2a3d1f112ee06c3efbd2e96658988b3e492d39c25435a9c8f88c`. The originally copied frozen type artifact is preserved in the prepared-source backup. No independent schema/decoder, SQL or producer test transfer.
- Individually executed `git cherry-pick -x`: `406529d0940da6f04d141da209d8d6eb324804fc` -> `09c57079a0c6805e651d28c2a4fe2640d5a74d17`; `0a6534974cee8556bf058ec01a716489824a485e` -> `228a283180eb95b2903e35a17955dc7edaa03638`; `2ced10599484cb2ca59c53c05b2318a544f1dea3` -> `1ffea89e09fa732cb59f19b572cac2e5ff6295c9`; `18aa2886d5ad017789725727df86cca4c2f33748` -> `c0e524bc84a0e21b9c9350e674f66eb7389b2c4c`. No whole-file Auth replacement or additional identity changes.

Both `src/app/(internal)/layout.tsx` and `src/app/account/layout.tsx` now call `WhiteLabelPublicationService.getRuntimeConfiguration()` using their existing `context.client`. Failure is passed as explicit null/unavailable, distinct from successful unpublished/legacy compatibility. No draft read or branding-derived permissions.

`src/app/api/white-label/runtime/route.ts` reacquires `getVerifiedSessionContext()` each request, reads the same Publication service/RPC, returns raw v1.0 union and private/no-store responses, delegates identity failures to `identityFailureResponse`, and redacts denied/malformed/transport errors into 403/503. There is no Tenant argument. The success response includes the verified actor ID in `x-wf-branding-actor`; the client rejects a changed actor rather than adopting their branding into the old workspace.

The existing provider now binds its default reader to that GET, uses the producer decoder, bounds the request to 15 seconds, keeps one observation in flight, discards old generations/Tenants/actors and avoids revision downgrades even after stale layout props. Initial failure is explicitly unavailable and can recover on the next fresh observation. Published raw colors remain exact; foreground contrast derives through existing unrounded helpers. The pure helper now uses the producer decoder, including its Unicode name limit. Existing tenant-root/four-portal scope and business component state are preserved. `/white-label` and descendants retain Wolf Forge and do not poll; login branding remains deferred.

Focused tests are prepared in `tenant-branding.test.ts`, `tenant-branding-provider.test.tsx`, `tenant-branding-shells.test.tsx` and new `tenant-branding-runtime.test.ts` for real layout/route wiring through the actual repository/service, compatibility, malformed/denied/transport cases, actor headers, initial failure recovery and stale-revision rejection. These are unexecuted source tests, not browser/API acceptance.

Actually performed: ownership/file-hash readback, empty-index checks, individual Auth dependency composition, exact producer blob readback and additive-type inspection, relevant installed Next docs/source inspection, manual scoped source review and `git diff --check` (exit 0). No tests, typecheck, lint, secret scan, build, backend, app server, runtime or browser operation. No credentials used. Supabase RPC documentation was consulted; the changelog markdown request could not be rendered by the web tool. No new SDK behavior was introduced.

Integration Owner `01a13515-4a2d-7a30-a4bb-65b554932bc9` was contacted for the sole focused slot. It explicitly declined to grant one because its current direct authorization covers credential-inventory Chunk 2A only, and it has not reconciled the queue. The existing queue is not a grant. Required next action: authorize that coordinator (or identify another authorized Integration Owner), reserve the focused tests/typecheck/scoped lint/secret-scan slot, address actual findings, then make one scoped Branding source commit. Do not claim a validated Branding commit before that gate.

After a passing scoped commit, Integration must compose it with `5e1d194` for separately allocated combined build/runtime QA. Remaining runtime checks: normal login, draft inertness and actual publish observation, reload/new-session, two-Tenant and actor switching, no-publication/legacy and denied/malformed/transport behavior, Platform Admin/login preservation, business-state persistence, four allocated opened portals/focus/long names at 320/360/390/430/768/1280/1440px. Other feature portals remain outside the allocated seam. Preserve Integration's body-min-width removal during composition. The affected local credentials and retained backend are not authorized for use here.

Canonical vault/Security notes and Global OS/Skills Index remain read-only and unchanged. No push, deployment, production, dependency installation or environment change.

## Allocation and contract

Existing registered worktree `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-WL-Branding-20261013`, branch `feat/wl-branding-20261013`, starting HEAD `b94afedb56e3e89f39efc8745e2a58b6015480ba`. Integration Owner registered the preparation receipt and approved six consumer paths, pure helper `src/components/shell/tenant-branding.ts`, Provider/Scope/hook `src/components/shell/tenant-branding-provider.tsx`, four shared portal paths, focused tests and this handoff. A same-origin runtime GET path is approved but remains unimplemented pending producer/Auth seams. Auth context resolvers remain untouched.

Contract: `WHITE_LABEL_PUBLICATION_CONTRACT_VERSION = "1.0"`, frozen at Integration's `docs/wl-draft-publication-contract-v1.0.md`. Exact shared type artifact copied only into the previously absent `src/domain/white-label/publication.ts`; source and destination SHA-256 both `68e2333102a9c1cd4210e10b655859c338241a36a51a1a07dcb964fd2452e02d`. This file remains Publication-owned. The final read-source SHA is pending; no schema, repository/service read implementation, generated declaration or backend was independently invented.

## Prepared source

- `src/components/shell/internal-shell.tsx`: optional typed runtime configuration; ordinary tenant workspace uses published presentation, `/white-label` and its descendants retain Wolf Forge. A published internal snapshot must match current `user.tenantId`. Desktop and mobile names derive directly from current props; no old-tenant snapshot state or configuration-based permission calculation.
- `src/components/account/client-account-shell.tsx` and `src/components/account/client-portal-sidebar.tsx`: same presentation union; workspace name remains separate from Company/person identity and portal module grants.
- `src/components/shell/tenant-branding.ts`: pure derivation using existing `colorContrast` and `previewForeground`. Raw published primary/accent are retained exactly in `--tenant-primary`/`--tenant-accent`; derived foreground/active-indicator and existing ink-token aliases provide contrast. Bounded/control-free stored names and exact lowercase hex values are checked before styling. Errors are not default states. Legacy module-only and unpublished states keep current defaults; no earlier branding is revived.
- `src/app/globals.css`: only appended `.tenant-workspace` selectors. Sidebar, portal rail, mobile drawer, action buttons and active accents consume raw colors with derived accessible foregrounds. Long published names wrap without clipping. Existing Wolf Forge mark and its navy-backed brand region are retained; no logo system, layout redesign, semantic state recoloring, root/body token mutation or login changes.
- `src/components/shell/tenant-branding-provider.tsx`: prepared 30-second visible observation with single-flight/coalesced focus/resume reads, effect-generation/scope checks, explicit unavailable errors and no revision downgrade. Reader dependency is optional only during this unbound source stage; no product mock or unchecked GET decoder is installed. Existing shell state is preserved; ordinary update never calls router.refresh or changes component keys.
- `src/components/ui/mobile-filter-sheet.tsx`, `src/components/account/ui/portal-dialog.tsx`, `src/components/shell/workspace-command-bar.tsx` and `src/components/shell/workspace-quick-action.tsx`: context follows their React body portals; Scope clones only existing DOM roots/Fragments to add variables and tenant attributes without positioning/focus wrappers. No-provider/control-plane roots keep default styles. Additional feature portals remain outside the allocated seam.

Both layouts remain unchanged until Publication supplies the exact domain/repository/service read-source commit and the four additive RPC declaration hunks. These shells currently receive no runtime configuration from product layouts, so prepared presentation is not live behavior.

## Prepared consumer tests

`src/tests/tenant-branding.test.ts` covers exact shared version, immutable raw colors, unpublished/legacy defaults, unrounded foreground/indicator contrast and refusal of invalid name/color/unknown inputs.

`src/tests/tenant-branding-shells.test.tsx` covers distinct Tenant A/B, desktop/mobile/portal presentation, current internal scope mismatch, unchanged business module maps, Platform Admin surface distinction, safe text rendering, prop-driven tenant/revision changes and preserved unsaved text/accepted decision state. These are mocked consumer tests, not real business or browser verification.

`src/tests/tenant-branding-provider.test.tsx` covers the observation deadline, single-flight/resume coalescing, hidden tabs, old scope/actor results, unknown/denied/transport failure, revision monotonicity, first publication and no control-plane polling. Portal tests assert existing DOM identity, focus/unsaved state and scoped cleanup without a body mutation. These tests are authored but unexecuted.

## Verification and outstanding dependencies

Executed: exact artifact hash/readback, source/destination/status inspection and `git diff --check`. Ignored checkout node_modules junction points to approved Integration/node_modules after package/lock hashes matched; no dependencies installed or changed. Test suites/typecheck/lint/build/browser/database verification have not run. Unit execution is explicitly queued after Shared Auth's focused window; no broader validation lease is held. No local commit has been made before required validation/secret scanning.

Outstanding:

1. Exact Publication read-source SHA, then authorized path-scoped transfer and four additive RPC declarations; bind layouts through existing `context.client`, not Auth-owned resolvers.
2. Bind approved `src/app/api/white-label/runtime/route.ts`: same-origin read-only GET, no Tenant parameter, fresh authorized context and private/no-store response, strict Publication-owned browser decoder. Current render resolvers redirect or are staff-only; await Auth's authorized-client/error seam. No inline polling Server Action, captured client/session or independent identity resolver.
3. Four shared body-portal seams are prepared and allocated. Other feature portals remain inventoried and need exact scope/coverage decisions. Do not claim every portal inherits current shell tokens.
4. Unit execution release, followed by distinct build/browser/environment receipts. No backend/app port was claimed. Runtime acceptance requires coordinator-approved composed source/environment and seven-width QA, reload/new-session, draft/live separation, publication refresh, tenant switch, legacy/unpublished, denial/failure and unchanged Platform Admin/login.

Starting branch retains its predecessor body min-width rule. Branding appended only tenant selectors; accepted Integration's body min-width removal belongs to Publication's separate prerequisite lease and must survive final source composition.

Canonical project/Security memory, Global OS, Skills Index, Auth files, migrations and environments remain untouched. No pushes, merges, deployment or production writes.
