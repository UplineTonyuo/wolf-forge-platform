# Forms enforcement: verified local handoff

2026-10-12, Codex. **Local acceptance passed.** This handoff accompanies the focused Forms feature commit; the final delivery reports its full SHA.

## Ownership and baseline

- Branch: `feat/white-label-forms-enforcement-20261011`.
- Accepted predecessor: `adad483cb23e3fc8c98c399ee2034f8b45ad1017`.
- Centrally reserved migration: `20261011172232_forms_module_enforcement.sql`, before the reserved Coupons migration.
- Regression suite: `136_forms_module_enforcement.test.sql`.
- One source/database writer: Codex. Independent reviewers made no source, database, Git or canonical-memory changes.
- Canonical Second Brain remains read-only. See [proposed memory changes](wl-forms-proposed-memory-changes.md).
- Assigned machine configuration and private QA tooling are excluded from this feature commit. Use the coordinator-owned environment helper and its current Forms identity record for local endpoints and startup.

## Preserved five policies

1. Forms OFF refuses collection schema/new submission, create/archive/draft/publish/assign/correction and trusted Forms writes. Management replay is refused OFF.
2. Outstanding assignments freeze unchanged. Paused UI preserves actual completion status; no cancellation, completion, publication or version re-pinning occurs.
3. Currently authorized history remains reachable, including history-only staff and paused client receipts. Tenant/Company/profile/membership/archive boundaries remain effective; inaccessible live Project and Ticket pointers are redacted.
4. Exact accepted submission replay is reauthorized and write-free while OFF. Guests receive only the persisted acknowledgement ID, with all other composite fields NULL; guests cannot read stored responses.
5. Re-enable changes eligibility only. It does not publish, re-pin or convert old Contact answers. Forms ON / Tickets OFF stores nongenerative Contact answers; corrections never generate original or replacement Tickets.

## Implementation and security controls

The migration adds five private helpers, two authenticated RPCs and ten Forms write triggers, and replaces seventeen accepted definitions. Tenant lifecycle locking precedes mutable record locks; actor authority is re-derived after waits. Root/assignment/Company/Project/version/field/supersession/latest-receipt relationships are validated. Trusted new roots require the current published version and an outstanding assignment where applicable; active parent checks protect corrections and later answers. The auth-NULL/no-publication bootstrap exception remains explicit.

The submission SELECT policy now uses the secured history helper, so staff with `forms.submissions_view` alone can list retained answers without acquiring builder definitions. Assignment history has a separate authorized reader. Notification visibility preserves Invoice/wallet behavior and suppresses stopped assignment work while retaining authorized response history.

Application changes separate receipts from collection schemas, refresh current scope, preserve accepted acknowledgements and remove stale collection controls. Public version eligibility is compared exactly. Assignment pins remain unchanged, including the existing superseded-version strand described by KI-140. Optional empty answers are omitted; boolean false remains meaningful. Renderer choices/calendar reuse the existing controls, including required-choice validation and focus return. Builder sizing is corrected at intermediate widths. Shared DatePicker colors/cursor contrast are improved without overriding selected-day white text.

## Verification performed

All listed final commands completed successfully; earlier preparation/failure output is historical evidence.

| Gate | Result |
|---|---|
| Full application suite | 233 files / 3,031 tests PASS, native exit 0 |
| Full clean pgTAP | 125 files / 5,828 assertions PASS, native exit 0 |
| Suite 136 | 74 assertions PASS; all ten seed assertions, including the six original security failures, retained |
| Two-session lifecycle races | 14 actual cases: seven writes in both publication orderings; lock waits observed; higher isolation refused |
| Post-wait authority | Four committed revocations: owner/client membership, Company archive, capability override; refused writes and unchanged Forms effects |
| Security mutation tests | 17 rollback-only mutants detected; exact function/ACL/config/trigger/receipt/assignment restoration after each |
| Authenticated browser | 96 main + 14 supplementary cases PASS at 320/360/390/430/768/1280/1440px |
| Browser states | Normal password login; owner/client/history-only staff/other-Company; PA-only/foreign-Tenant business-session refusal; guest; stale OFF, frozen assignment, response readback, restored collection, stale public version |
| Accessibility | Opened controls, Escape/focus return, reduced motion and unrounded control/calendar contrast, including selected adjacent-month dates |
| Typecheck / zero-warning lint / production build | PASS, native exits 0 |
| Application SQL lint | public/private schemas, error threshold, PASS |
| Source/installed definitions | All 24 bodies match; 56 inventoried ACL/configuration signatures preserved; ten guards installed |
| Type contracts | Both new RPC declarations match fresh CLI-generated public types exactly; unrelated KI-156 drift preserved |
| Fresh replay / registration | All 151 source migrations replayed; unique final version `20261011172232` registered |

The six synthetic seed failures at the accepted baseline covered nullable assignment schema/submission/history, foreign authenticated schema, full guest replay and unrelated guest history. Original seed SHA-256: `101e43f97adf803cadf298477471b135779d075e3a4d6a19065db30b8eb21576`. The suite was extended without weakening those assertions. Existing suites were adapted only for the approved optional Forms policy, earlier NULL rejection, tenant-qualified helper policy and earlier trusted pointer rejection; broader enforcement assertions remain.

Independent Forms review found and reconciled NULL/privacy, post-wait authority, trusted pointer/current-parent, history-only listing, notification, stale UI and version eligibility findings. Its latest executed consumer tests passed 48 tests in three files. Reviewer C found no remaining confirmed BLOCKER/HIGH/MEDIUM and independently passed 56 tests in three files. Reviewers did not execute database tests. The initial old-pin concern was withdrawn after checking the accepted submission predecessor; KI-140 remains.

## Disposable environment replay

Browser/race evidence was captured against the final implementation before clean replay. Synthetic data was backed up privately. The first CLI reset failed before repository migrations, consistent with the reported [initialization race](https://github.com/supabase/cli/issues/6445). After verifying partial state and pausing only the assigned Forms services, the deliberate retry replayed all migrations successfully.

Reset recreated the disposable Forms cluster. Its current identifier was verified through SQL and a temporary API identity probe, then the Forms identity record was reconciled with its prior copy retained. Project/container/volume/network identities, ports, local credentials and configuration remained assigned and unchanged. The temporary probe was removed. Final fresh state has no Auth users, Invoices or wallet transactions and retains the source-defined 59-Service catalog. Browser fixtures are in the private backup, not in the final clean database.

Local production BotID login correctly fails closed without its provider. Normal password sessions were established in development with protection unchanged, then carried into the local production build for authenticated business-flow QA. Quick Access and application authorization bypasses were not used. No hosted or Production validation is claimed.

## Integration responsibilities and remaining issues

Integrate Forms first, then compose Coupons replacements and later Services in a separately authorized integration worktree/disposable stack. Shared collisions include module validation, permission engine, module access/navigation and notification visibility; reconcile complete definitions, grants, policies, triggers and dependencies. The shared DatePicker stylesheet is another small collision surface. Never choose whole-file ours/theirs to discard another module's conditions. Isolated Forms acceptance does not prove combined correctness.

KI-139's reproduced NULL paths are fixed and covered on this branch; canonical resolution awaits the sole memory writer. KI-140 version strands remain open. KI-153, KI-154, KI-155 and KI-156 are outside this acceptance and remain unresolved where recorded. No automatic re-pinning or broader type regeneration was introduced.

No canonical memory change, merge, push, hosted write, deployment or implementation-agent launch occurred. Application servers are stopped. Next action is integration-owner review under new integration authorization; stop Forms implementation here.

Final preservation readback: project memory, Security notes and Skills Index match startup. The Global OS changed externally during QA; Codex read its updated worktree-protection rule before committing. This task made no canonical writes.
