# White Label Studio V3 handoff

Date: 2026-10-12. Agent: Codex. Assigned branch: `feat/white-label-builder-studio-20261012`.

Acceptance: PASS within the verification limits below. The local feature commit is recorded in the following documentation checkpoint. Starting HEAD is `137ab7f34a8d160f99f6a163e86416fba44fcdea`; completed V2 implementation is `01e9d7cdadf868b4a8ad600dae333374fef275ee`.

## Startup and isolation

The configured Global OS, Skills Index, established project memory, V2 interactive Studio handoff and dedicated QA environment handoff were read. Canonical Obsidian memory remained read-only. Active-worktree checks found no competing writer or unfinished background implementation in this assigned checkout. Historical untracked diagnostic screenshots were preserved and excluded from staging.

Dedicated QA: `C:\Users\TrojanNiAnton\Documents\Wolf-Forge-Builder-QA-20261012`, app copy `app`, loopback port 3013, Supabase API 57321 / PostgreSQL 57322. Guarded database system identifier: `7695498287066267686`. The existing launcher verifies source/index/status hashes, frozen app manifest, database identity and migrations before starting the app. V3 synchronization verifies absolute source/target paths, backs up changed staged-app files and guard manifests, copies authorized tracked source, rechecks credential/fixture/configuration/identity bytes and restarts only the recorded dedicated app process tree. Existing build cache is preserved unless explicitly archived. No database reset or migration occurred.

No canonical, Forms, Coupons or Services worktree or database was changed. No shared notes, publication, hosted environment, push, merge or deployment was authorized or performed.

## Draft management

`WhiteLabelService.listDrafts()` projects summaries from the existing authorized Tenant list and existing per-Tenant draft retrieval RPC. Reads run in bounded batches of six. Each underlying RPC retains its database entitlement check; a denied read produces no partially authorized summary list. The new server action reuses the existing local-only Studio, Quick Access exclusion and verified Platform Admin service boundary.

No new table, migration, publication action, browser-local persistence authority or save contract was introduced. Continue Editing re-reads the selected Tenant's actual persisted draft. List cards use authoritative name, colors, module keys, revision and nullable saved timestamp. Revision zero is explicitly never-saved/default and has no fabricated timestamp. Suspended/archived drafts remain read-only.

All Drafts uses the existing PortalDialog with Keep editing, Discard and return, and Save Draft then return. Failed saves keep the accepted replay payload. In-flight saves block dismissal/navigation; a confirmed replay with newer unsaved edits requires another save before departure. Only the server-confirmed saved state updates the card summary.

Native history entries retain Next's existing state and add a Studio index. Same-document Back/Forward transitions use the Navigation API's entry index where available, with marked-entry fallback. Dirty traversal is bounced back before Next's listener runs and resumes the exact traversal only after the user's choice. Same-Tenant/hash-only traversal preserves edits. A query parameter selects a requested resource and never grants authorization.

## Compact interface

The editor uses 37% configuration / 63% preview space at desktop width. Existing Inter, navy, neutral canvas, controls, dialogs and navigation icons are reused. The permanently expanded template grid is now one AnimatedSelect with paired swatches; all six templates and custom-color state remain. Narrow screens stack custom color fields so full HEX values remain visible.

All nine native module checkboxes remain independently persisted, in two columns on desktop and one on small screens. Recommendations, dependency warnings and module count remain visible. Accessible details hold longer descriptions and unchanged publication/financial safeguards.

The simulated sidebar occupies 21% of the desktop frame, with scoped spacing to avoid inherited real-shell density overrides. At desktop widths it has a 620px maximum height and scrolls its complete navigation instead of growing the outer page. Desktop mouse targets remain compact; mobile/coarse-pointer navigation targets remain 44px. Cards form three columns where space allows with concise descriptions. Existing simulated navigation, detail views, module availability and Desktop/Mobile state remain; no preview control uses real Tenant routing or mutation.

## Fresh verification evidence

Authenticated browser: actual Chrome via computer-use, normal email/password Platform Admin login against the dedicated QA stack. Historic V2 totals are not V3 acceptance evidence.

- Manager showed existing A/B drafts and the never-saved System Tenant using actual persisted fields.
- Continue Editing A loaded original revision 10, name `haha`, default colors and seven modules.
- All six template applications updated both HEX fields and preview CSS. Keyboard opening/selection, Escape with trigger focus, outside dismissal, invalid HEX disabling Save/Review, reset, custom state and contrast guidance were exercised.
- Fourteen enabled navigation destinations in each of Desktop and Mobile modes changed only the simulated view: 28 checks; real pathname stayed `/white-label`.
- Turning Services off retained selected dependent keys, displayed dependency warnings and removed their eligible preview navigation. Turning it back on restored eligibility.
- Saved A through Save Draft then return: revision 11, `V3 QA Workspace A`, Forest Premium, nine modules. Refreshed manager retained these persisted values.
- Exact accepted save replay through the existing authenticated RPC returned `already_applied: true`; A stayed revision 11, B stayed byte-identical at revision 1 and runtime authority remained unchanged.
- Saved B separately: revision 2, `V3 QA Workspace B`, custom `#345678` / `#cba765`, four modules. Returning and reopening A restored A's own revision 11, Forest colors and nine keys.
- Two genuine authenticated tabs loaded A revision 11. The first saved revision 12; the second retained its local name and revision 11, reported a conflict and disabled Save. Explicit Load latest replaced the local state with the actual winner at revision 12.
- Dirty browser Back offered the departure dialog. Keep editing retained the local name and URL; Discard returned to Drafts; Forward restored persisted A. Mobile Jump to preview/hash Back retained unsaved text without a departure dialog. Review received heading focus and Back to editing returned focus to Review Draft.
- The never-saved System configuration resumed real defaults with six modules, no timestamp and revision zero, and was left without saving.
- Genuine ordinary staff normal login led to its ordinary Operations shell. Direct Studio access showed the intended 404 boundary after a narrow gate-order correction; no editor/list was rendered. The old Settings route retained its existing redirect to the staff landing page.
- A genuine synthetic client normal login led to the client portal. Both Studio and legacy deep links redirected to `/login?reason=staff-only` with “This area is for Wolf Forge team members.” No editor/list rendered.
- Normal-password SSR/RPC checks additionally verified admin entitlement, staff/client non-entitlement and RPC denial `42501` for draft/list reads. Generic streamed not-found markup alone is not used as authorization proof. Admin legacy redirect preserved the requested Tenant and loaded its actual draft.

Seven widths were exercised with all nine modules selected, open six-option menus and Projects/Tickets interactions: 320, 360, 390, 430, 768, 1280 and 1440 at height 900. Every real pathname remained `/white-label`; no measured horizontal overflow. Final document heights: 3374 / 3000 / 2926 / 2909 / 1889 / 935 / 900 respectively. The 768px panel stacks custom colors; both HEX fields measured 179px and visibly display full values. Narrow layouts scroll naturally. At 1440x900 all controls and the usable preview fit, including the all-enabled long-name case; sidebar width remains 21%.

Long names, dependency details keyboard opening/Escape, contrast warnings and Mobile previews at 320/390 remained readable with natural scrolling. Actual browser zoom shortcuts had no effect through the connector; 720x450 equivalent reflow was verified without horizontal overflow and is explicitly not an actual 200% zoom pass. No independent screen-reader execution is claimed.

After the final build, Chrome disconnected before an additional Settings/All Conversations reachability recheck in the bounded sidebar. The complete 28-destination interaction pass preceded that CSS bound; subsequent seven-width Projects/Tickets checks and independent screenshots used the final CSS. The extra post-build check and a fresh live-tab handoff are not claimed. This does not replace the recorded authenticated acceptance evidence.

Original A/B name/colors/module keys were restored through normal revision-aware UI saves. Final A revision 13 and B revision 3 preserve the advanced audit/concurrency history. The System Tenant remains byte-identical at revision zero. Only the temporary synthetic client identity/company was removed; the two original identities, credentials and fixtures remain. Final guarded readback asserts original draft content and runtime invariance: zero publications, invoices and wallet transactions, unchanged nine effective module grants per active QA Tenant. Safe result projections are included under `docs/qa/white-label-studio-v3`; credentials and raw logs remain private.

The ten changed production source files have matching SHA-256 hashes in the served app copy. Exact pairs are recorded in `docs/qa/white-label-studio-v3/served-source-hashes.json`. The running Next binary is resolved through the existing shared dependency junction; its app source/cwd and environment remain the dedicated QA copy.

## Checks and review

Focused White Label/auth-cookie run: 7 files / 105 tests passed, including 11 new manager regressions. Final page/shell/action run: 3 files / 17 tests passed, including six new page-boundary regressions; these suites overlap with the earlier run.

Final full-suite acceptance passed after the last source corrections: 236 files / 3,061 tests, exit 0, 339.56 seconds. Serial runs used a 30-second test/hook limit with the dedicated QA app stopped to free memory. A preceding full run passed 235 files / 3,055 tests before the six page-boundary tests. Earlier resource-contended attempts hit unrelated five-second test timeouts; focused reruns passed, and incomplete retries were interrupted only through the verified own test process trees. No timeout or incomplete run is reported as a pass.

Native independent read-only reviewer `v3_security_review` inspected the action/service/draft/history boundary. It found save-dismissal and Back/hash traversal races; all were corrected with regression tests. Final source review found no concrete authorization, isolation, revision, replay or publication defect. A second narrow review accepted checking Quick Access/admin entitlement before Settings permission, while retaining Settings access for entitled admins. Six new page-boundary regressions plus shell/actions passed: three files / 17 tests. This reviewer did not execute browser or database tests.

Native read-only visual reviewer `v3_explore` inspected the final seven viewport layouts, open dropdowns, long-name Mobile previews, saved A/B draft cards and conflict presentation. It found phone/tablet HEX truncation; controls were stacked and recaptured. Final review: PASS, no clipping observed in the inspected scope. Whole-document capture can relocate fixed shell elements within a tall image; settled phone DOM placed the title y82 below the command bar y0..64. This was screenshot/source review, not independent browser or persistence execution.

Final typecheck, ESLint with zero warnings and webpack production build passed after the page-boundary and last CSS corrections. The staged-delivery secret scan passed with zero findings across 1,680 tracked files. Runtime dependency audit passed the configured high-severity threshold but reported one existing moderate `music-metadata` vulnerability; no dependency or lockfile was changed. Browser connection timeouts and machine memory pressure were recovered without restarting another application's process. Development diagnostics showed Grammarly-added body attributes causing hydration warnings and MetaMask extension listener warnings; these are recorded without claiming a clean extension-free console.

## Changed source

- `src/app/actions/white-label.ts`, `src/domain/white-label/draft.ts`, `src/services/white-label-service.ts`: authorized read-side summary projection.
- `src/app/(internal)/white-label/page.tsx`: established unavailable boundary now precedes ordinary staff's Settings permission exception; authorized admins still require Settings access.
- `src/components/white-label/white-label-draft-list.tsx`: new real-data draft manager.
- Existing editor, builder, color controls, preview and CSS module: resume/history/departure behavior and compact layout.
- Existing builder/draft/action/interactive tests plus `white-label-draft-manager.test.tsx` and `white-label-studio-page.test.tsx`: summary, replay, isolation, loading/denial, resource selection and history/save-race regressions.

Potential integration overlap is confined to these White Label files and associated tests/docs. No navigation registry, real shell, database schema or module-enforcement policy changed. Concurrent changes touching the editor/action/service need semantic reconciliation; actual integration conflicts have not been merge-tested.

## Limitations and proposed later memory changes

Summary reads are one existing draft RPC per authorized Tenant, bounded at six concurrent reads. Very large fleets may later justify a separately reviewed server-authorized summary RPC. Browsers without Navigation API indices can guard marked Studio history; arbitrary unmarked external multi-entry traversal falls back to one step. No claim is made for every browser history implementation.

After coordinated integration and fresh acceptance, propose narrow updates to existing `01 Current State.md` (draft manager/compact UI), one `03 Implementation Log.md` milestone (actual commits/checks/evidence), and `05 Architecture Map.md` (authorized read-side projection and history handling). Security notes may record preserved gates and independent review. Update Known Issues only for verified unresolved limitations. These are proposals only; canonical memory was not written.

Version authority: installed Next 16.3.8 docs and React 19.2.8 packages. Native history follows the installed Next linking/navigation guidance; effect cleanup follows [React's official useEffect reference](https://react.dev/reference/react/useEffect). History indices follow [MDN NavigationHistoryEntry.index](https://developer.mozilla.org/en-US/docs/Web/API/NavigationHistoryEntry/index). No framework upgrade or dependency install.
