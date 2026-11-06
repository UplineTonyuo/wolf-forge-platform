# Main integration refresh — 2026-11-06

This section supersedes stale branch/live-state and assignment-scope facts below; historical evidence remains preserved. The owner requested continuation here without resetting the database password. The preceding release task's last turn is complete; the existing integrated checkout was clean at f0de2b3 before this merge.

- Integrates latest verified live main **886bfe9cdaff0272c95a65e0226008c78f58da22** into reviewed calling candidate **f0de2b3ec28fa1ddb9d0eaa4200c0fc106aedaa3**, preserving the live Tickets label and approved loading improvements. Client Ticket detail auto-merge changes only its document/back-link labels relative to the calling candidate.
- Sole manual conflict: `vercel.json`. Preserve the union of all seven false branch-deployment entries from both parents, including the original PR114 source and integrated-validation branches; both cron jobs unchanged. No runtime calling, notification, task, manager, auth or policy implementation was edited in this refresh.
- Fresh local checks: **4,692 application tests / 393 files passed** in one 1,536 MiB, single-worker run; route type generation, final standard-path typecheck (2,048 MiB heap), full lint, tracked secrets **0 / 2,342**, staged whitespace and production dependency high threshold passed. Five existing moderate production findings remain. Generated QA-dist changes to `next-env.d.ts` / `tsconfig.json` were reconciled, then normal-path typegen/typecheck passed with tracked configuration unchanged.
- Independent fresh-context source review found no Critical, Important or Minor integration defect. Source review deliberately does not establish browser/device behavior, hosted configuration, backup validity or real media.
- All exact ten reviewed migration blobs match f0de2b3. Fresh production migration metadata: **207 applied rows through 20261103161636; 0/10 release migrations applied**. No production mutation was made.
- Local full build remains unrun below the existing 5.5 GiB guard. Exact-head hosted CI is **pending at this commit**; prior full SQL/physical/transport/build results are historical, not a pass for this merged tree. Reuse one automatic PR validation only; do not dispatch a duplicate full run.
- Free-only preflight: account remains Free; fresh all-product report shows Actions-only compute, **1,723 Linux minutes / $10.338 gross and discount, $0 net**. Included compute is $12; one existing PR workflow has a 110-standard-Linux-minute ceiling ($0.66). Future transport/main checks require another remaining-allowance read. No queued/in-progress repository workflows at preflight; no paid runner, plan or budget setting changed.
- **Production still held:** owner-operated backup login was rejected; inventory is empty and no archive exists. No password reset, native login retry, automated-backup retry, new role/token, backup export, Storage download, hosted migration, PR merge or WOAD promotion occurred. The prior automated-backup rejection remains in force. Verified owner DB+Storage backup/encryption must precede the migration/release gates. Owner media/browser acceptance remains post-rollout under the existing authorization; no actual media pass is claimed.
- Keep the current two-account pilot and existing safeguards; no RojanCRM, William/client account or customer-record changes. Canonical notes remain read-only; current-state memory does not yet record the latest verified checkpoints. Shared Graphify provenance disagrees, so source search was used without refresh.

Evidence for this continuation: `outputs/orders-calls-main-refresh-20261106/` under the existing project task workspace, including the startup packet, merge/migration proof, local logs, review and subsequent CI receipts. Working branch: `codex/woad-integrated-validation-20261105`; PR114's existing source ref: `codex/woad-orders-calls-ux-20261104`. Preserve that existing mapping and keep PR114 draft until its production gates pass.

---
# Agent 1 calls diagnostic follow-up — 2026-11-05 21:47 SGT

This is the current **calls-only diagnostic** follow-up. The release history below is preserved; its superseded 90b94748/uncommitted/unexecuted headings are historical. The latest full-release evidence is `outputs/orders-calls-final-audit-20261105/summary.md` under the existing task workspace. This assignment does not authorize rollout.

**Result: the genuine direct-client Ticket failure is still undiagnosed because its actual request could not be inspected. No additional application defect was confirmed, so no application/schema/test code was changed. Existing Order calling is committed but is not serving.**

## Fresh checkout and access evidence

- Verified Platform origin `https://github.com/UplineTonyuo/wolf-forge-platform.git`, branch `codex/woad-orders-calls-ux-20261104`, clean starting HEAD `6b60e8e8800af74e72de5ba93ae58f825f8241eb`. Original session `01a1a678-218d-7ba2-8b21-6876f09bba88` was not loaded and its recorded turn completed; no active second writer was found in this checkout. Navigation/performance threads were active in their separate lanes and were not edited.
- Process environment resolved the Global OS to `C:/Users/TrojanNiAnton/Downloads/Anthony OS-20261009T175758Z-1-001/Anthony OS/10 Templates/Coding Agent OS/CODING AGENT OPERATING SYSTEM.md` and canonical memory to the same vault's `02 Projects/Wolf Forge Platform/AI Memory`. Skills Index and relevant existing memory/Security notes were read. The configured White-Label recovery repository is separate. Older canonical deployment/phase facts were not treated as current evidence; vault notes remain read-only.
- Shared Graphify passed origin/task/pending/version/provenance checks before and after one bounded query: version 0.9.90; published/build/graph HEAD all `eddede8f96bbb8a0cb1c7826b2d8fcd115dbc821`; task Ready; no pending journal. Its older snapshot was navigation context only; references were checked in current source.
- Fresh GitHub read: PR114 open/draft/unmerged at `6b60e8e`. Fresh Vercel alias/deployment read: WOAD still READY on `dpl_hLstfmZUqRVvojtkQoiGZ6hJhjDN`, SHA `7aa06cf7e784a7a792d87d07661f9d7df3b7e14a`. Its two Order conversation components lack the committed Order controls.
- Fresh read-only production SQL: 207 migrations through `20261103161636`; **0 of the exact ten release migrations applied**; no `app_order_call_current/prepare/history` RPCs. Existing Ticket current/prepare/history definitions match the serving migration contracts.
- Approved pair and Ticket `628ca6d4-259d-42ca-b637-57cfc9353364`: approved client is the Ticket client; both approved identities are pilot-included and participant-eligible; one eligible saved team recipient. Environment/media/exclusive-account verification and usage freshness/effective calling all passed at inspection; pilot count remains two. The client not being a saved internal recipient is expected. These aggregate predicates do not verify the browser's actual identity, Tenant selector or Auth session.
- The owner confirmed direct client login and opened `/account`. Browser inventory still reported `The browser access host is unavailable`. Normal Chrome app inspection was refused with `Computer Use was not approved to use Google Chrome`, including after the owner's explicit renewed authorization. No account menu or endpoint could be inspected. **Actual signed-in POV, failing action/path, HTTP status, sanitized response code and request ID remain uncaptured.** No support-mode cause or production reproduction is claimed; no alternate session, JWT, Auth link or access workaround was attempted.

## Traced boundaries and Order readiness

| Boundary | Verified source behavior |
| --- | --- |
| Shared provider/controller | Both shells bind `InboxCallProvider` to the current profile. Mount/recovery reads `current`; explicit conversation controls read `current` with exactly one target. Failed idle reads hide controls; a live call failure releases local media. Call IDs/profile/target projections are validated; uncertain invitation retries retain their request ID. |
| Client Ticket UI | `ticket-client-conversation.tsx` independently loads participant history and mounts existing `TicketCallControls`. Opening preparation reads `prepare`; microphone/camera checks and invitation require separate explicit actions. No media acquisition was performed by this diagnostic. |
| HTTP/session/service | `GET /api/ticket-calls` checks same origin, strict action/target, verified session/Tenant and support refusal before user-scoped RPCs. `getVerifiedSessionContext` verifies claims; `private.ticket_call_session` independently requires a matching live Auth session. `current`, `prepare` and `history` use distinct RPCs. History does not depend on provider enablement. Candidate responses distinguish 401/NOT_AUTHENTICATED, 403/SUPPORT_MODE or PERMISSION_DENIED, 429/RATE_LIMITED and 503/CALL_SERVICE_UNAVAILABLE. Serving 7aa responses omit these codes. These are source contracts, **not observed failing-client HTTP results**. |
| Recipient authority | Client Ticket preparation offers eligible personally saved internal recipients; admission rechecks the selected recipient. Native Order preparation offers eligible order/task assignees to clients and eligible company clients to internal callers. Linked Order preparation preserves the legitimate Ticket peer/recipient rules. No broadcast, arbitrary recipient or pilot expansion was added. |
| Native and linked Orders | `/orders/[orderId]` passes `orderId`; `/account/projects/[projectId]` passes `project.id` through `ClientProjectDetail` to `ProjectConversation`. Both existing components use `OrderCallControls` and order history. Service calls explicit `app_order_call_current/prepare/history` and `app_request_order_call`. `conversation_call_target` resolves a real same-Tenant linked Ticket or a native order; the ledger enforces XOR Ticket/order targets. No Ticket is created and a native order UUID is not submitted to the Ticket request RPC. |
| History/deep links/lifecycle | Existing history is participant-scoped, keyset-paginated and limited to 50; late responses cannot replace another conversation's history. `/calls/[callId]` reauthorizes before redirecting to `/orders/<id>?call=...` or `/account/projects/<id>?call=...`, with legitimate linked-Ticket mapping. The same call ledger, claims, media lifecycle, device limits, cleanup, idempotency, busy refusal, reservations, budget and stream controls are retained. |

The confirmed cause of **missing Order controls** remains the serving/candidate deployment and schema gap. It does **not** establish the cause of the separate direct-client Ticket error. No speculative correction was made.

## Fresh validation and limits

Executed locally against unchanged application source, one worker, cache disabled and config runner used to avoid config-bundle/cache writes through the shared `node_modules` junction:

```powershell
node --max-old-space-size=512 node_modules/vitest/vitest.mjs run src/tests/ticket-call-route.test.ts src/tests/ticket-call-service.test.ts src/tests/call-controller.test.ts src/tests/order-call-target.test.ts src/tests/ticket-call-controls.test.tsx src/tests/ticket-call-history-sync.test.tsx src/tests/call-recipient-picker.test.tsx --maxWorkers=1 --no-file-parallelism --no-cache --configLoader runner
node --max-old-space-size=256 --test scripts/qa/check-ticket-call-transport.test.mjs
node --check scripts/qa/ticket-call-concurrency.mjs
node --check scripts/qa/check-ticket-call-transport.mjs
git diff --check
```

Results: **7 Vitest files / 55 tests PASS**, transport acceptance-helper **1/1 PASS**, both syntax checks and whitespace PASS. Fixtures mock actors/network/media; this is not actual Auth-session, ringing, two-person media or rendered-browser acceptance. No new regression/fix pair exists because no concrete new defect was confirmed. This is approved existing-work diagnosis, not a new design/feature exercise.

Historical only: exact candidate 6b full CI41903542090 (4612 JS / 7234 SQL), database41902431809 and transport41905024772 remain the prior release evidence described by the latest summary; they were not rerun. CI-only concurrency/transport/provider-stub guards were preserved and not bypassed. No install, typecheck, broad suite or build was started in this Agent 1 slot. Available RAM was initially 0.65 GiB and 2.86 GiB before the bounded fixtures; the 5.5 GiB full-build guard remains.

Pending only if the coordinator assigns a later serialized heavy slot: `node --max-old-space-size=2048 node_modules/typescript/bin/tsc --noEmit --incremental false`; full `node --max-old-space-size=2048 node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism --no-cache --configLoader runner`; `npm run build` only above the existing RAM guard. Isolated SQL/physical/transport reruns require their existing authorized disposable Linux CI environment, which this assignment prohibits dispatching. Documentation-only follow-up does not claim a fresh full candidate pass.

Next action: obtain approved browser-tool access to the existing genuine client tab; verify its POV, then capture only action/path, HTTP status, sanitized response code/request ID and relevant call UI, without starting a call or granting device permissions. Diagnose that response before proposing a fix. Order release remains blocked by the existing private-backup verification and migration/integration/promotion gates; the rejected automated backup was not retried or bypassed. No push, PR/CI dispatch, merge, deployment, hosted mutation, provider change, call, message, account change, vault write or backup inspection was performed. Only this existing handoff was updated; no alternative memory/release process was created.

# Historical handoff — 2026-11-05 (superseded where noted above)

**Latest authorization:** owner conditionally approved the full existing release via `approved-release-continuation.txt`. This supersedes historical hold/CI-only wording below. First commit/checkpoint the reviewed correction, verify current included Actions allowance, obtain isolated RED/GREEN and final candidate acceptance, then verified private backup, exact ten migrations, controlled merge/merge-result checks and production-config WOAD promotion. No routine reapproval; no paid usage or unrelated scope. Current billing APIs404; fresh usage evidence is pending before any dispatch. The historical and local preparation evidence below must not be mistaken for new SQL acceptance.

**Notification first-opening correction is LOCAL/UNCOMMITTED and not SQL-accepted.** Coordinator recheck `outputs/orders-calls-final-audit-20261105/review.md` found the original backdated-producer race still at90b94748. The green results below remain valid for their exact SHA/executed cases; they do not cover this counterexample or the changed SQL. Badge/module masking is fixed and is not part of this correction. No broad dependency/legal audit or unrelated repair was added.

Exact schedule: producer begins atT0; holder owns recipient opening lock; a NEW opening capturesT1>T0 and waits; the producer calls the existing canonical conversation producer with `now()`=T0 and commits; holder unlocks. At90b94748, the later UPDATE takes a fresh snapshot and marks the late new/refreshed row read because its timestamp is older thanT1. The previous passing physical case used the SAME request ID after the first RPC and skipped that UPDATE. A rate-counter row wait before capture is another instance of the same gap.

Prepared fix in the existing UNAPPLIED notification migration: one SQL statement uses CASE to enforce the unchanged60/min admission before the unread scan, while retaining that statement's pre-wait MVCC snapshot even when admission blocks. It captures only eligible IDs plus xmin/ctid into transient memory before receipt cleanup/recipient serialization; UPDATE requires the same row version and repeats all existing eligibility predicates. No producer timestamps, public schema, grants, receipt expiry/conflict/replay/count,300-receipt cap, badge masks, retries or polling rules were weakened. Tuple identity also distinguishes refreshed versions written by the same transaction. This is a source-reviewed approach pending execution, not a proven immutable-snapshot claim.

Source basis: PostgreSQL17 [command snapshots](https://www.postgresql.org/docs/17/transaction-iso.html), [procedural volatility/snapshots](https://www.postgresql.org/docs/17/xfunc-volatility.html), [CASE evaluation](https://www.postgresql.org/docs/17/functions-conditional.html) and [row-version system columns](https://www.postgresql.org/docs/17/ddl-system-columns.html). These establish the intended mechanism, not an executed SQL acceptance result.

Prepared RED/GREEN proof is **UNEXECUTED**: guarded physical harness uses distinct producer/holder/opener sessions, NEW IDs, exact blocking PID/lock-type observation and the real `now()` producer. It tests recipient and rate-counter waits, each with new row, unread-row refresh and read-to-unread refresh, plus an unread-row UPDATE/EPQ wait held by the producer itself. The exact90b94748 function is renamed only into the opener's temporary schema; the SAME first-opening invariant must fail there, then pass against candidate SQL. Replay and a subsequent explicit opening are checked separately. SQL205 additionally stages publication after receipt insertion, including same-xmin refreshes. No fabricated/model SQL pass: no authorized isolated PostgreSQL target is available locally; no Docker or CI was started. Physical RED and GREEN remain pending until the hold is lifted and an authorized isolated target is available.

Local validation for this preparation: existing bell/action regressions **2files/17tests PASS** (UI compatibility only); TypeScript noEmit/incrementalfalse2048MiB exit0; final JavaScript harness syntax/ESLint1536MiB and whitespace PASS; inclusive tracked+untracked scanner0/2337. Exact baseline function comparison passed, SHA256 `17d1446dc0791a61135fe34baa6a668d38401695076b7ec7a96972bfb45a96a7` after normalizing only its temporary function name. Targeted read-only reviewer found no remaining concrete source defect, including rate-wait snapshot/CASE and UPDATE/EPQ schedule. These are not SQL execution proof. SQL205, baseline physical reproduction, candidate physical acceptance, pgTAP/RLS/plans and affected/final CI for the changed code are NOT RUN. Source90b94748 remains HEAD; source edits plus the existing handoffs are uncommitted/unpushed. The newly added test-only fixture is `supabase/tests/fixtures/notification_opening_90b94748.inc`. Old90 release wrappers/hashes/preflight and accepted CI are stale for this changed source and cannot be used to release it.

The committed seven-item baseline is [90b94748f64d3e40d54af052b9749a67f91b2534](https://github.com/UplineTonyuo/wolf-forge-platform/commit/90b94748f64d3e40d54af052b9749a67f91b2534), tree `f5f0dcdd057702ee15a2fab5ae6bbb71579ff52d`, on `codex/woad-orders-calls-ux-20261104`. It has the first-opening gap described above; the local correction is not part of that commit. Baseline7e011865 and its security/Denial-of-Wallet repairs remain ancestors. [PR114](https://github.com/UplineTonyuo/wolf-forge-platform/pull/114) remains draft/unmerged at the last readback. **No further dispatch, production migration, merge or deployment under the owner hold.**

The preserved [transport run41877061435](https://github.com/UplineTonyuo/wolf-forge-platform/actions/runs/41877061435) is now completed/success, with both enabled jobs successful. The apparent queue was stale status publication: logs show runners began17:22:59UTC, secrets finished17:24:31, transport acceptance passed17:29:24 and build cleanup ended17:29:48. API/UI still reported queued/null runner/no steps afterward. Direct job/attempt reads later exposed completed-success steps; overall success published17:43:06. There was no pending approval, active repository concurrency blocker or disabled Actions setting. No cancellation/redispatch/deployment followed the owner's hold. GitHub's internal cause remains unverified. An earlier [Actions/status incident](https://www.githubstatus.com/incidents/xr3myzj7ms51) resolved17:01, before this run's17:22:54 creation, and is not causal proof.

| Item | Current behavior and principal paths |
|---|---|
| 1. Order calls | Team `order-conversation.tsx` and client `project-conversation.tsx` use shared accessible controls, recipient preparation, screen, incoming/ringing, lifecycle, history, notifications and deep links. Explicit order RPCs resolve a real linked Ticket or native `order_id` in the existing private ledger. Tenant/order FK, XOR target and one-live-order uniqueness; no fake Tickets/rooms/order-as-Ticket IDs. Post-lock assignment checks, pilot, budgets, replay/admission and history/device/stream limits remain. |
| 2. Tasks | `project-tasks.module.css` and `project-detail.module.css` fix padding, wrapping, labels, form alignment and responsive reflow. Stable request IDs, in-flight/retry/validation and authoritative client progress refresh remain. Rendered width QA is pending. |
| 3. Diagnostics | Call API/history hook give deliberate support403 `SUPPORT_MODE` an accurate nonretry explanation. Genuine-session401, quota429 and backend503 remain distinct. Real synthetic client history passes in CI; provider-off history passes focused tests. No genuine-client production failure was reproduced or inferred from the support screenshot; impersonated live calls remain disabled. |
| 4. Status | Only the client message-detail title working pill is removed. Side-summary/stored status and permissions remain. |
| 5. Notifications |90b94748 fixes full counts/module masks and acknowledged explicit opening/replay, but timestamp-only FIRST opening still reads backdated late publications. Local row/version snapshot correction is prepared and SQL-unverified. Managed/unmanaged click/keyboard, no hover/mount/prefetch marking, same-key retry/expiry recovery, Unanswered independence and no added polling remain. |
| 6. Manager | Clients page/table/actions/service/repository persist selected account-level manager metadata. Active same-workspace manager and module/edit checks, repeated after lock waits; bounded100 accounts, per-account honest results, replay/audit once and authoritative refresh. No contact mutations or role/access/impersonation grants. |
| 7. Navigation | Shared registry hides Operations while `/todo`, titles, workflows, data and permissions remain. |

The minimal native backend extends the existing call ledger with an explicit order target. Account manager assignment is a private metadata relationship independent of authorization. Both are accepted in isolated CI and remain unapplied in production.

A verified compatibility blocker was fixed before release: serving7aa06cf strictly parses existing stream context as exactly `{topic}`. The pending lease migration added keys, causing503 and an unused lease during migration-first rollout. The corrected **unapplied** migration creates `app_ticket_call_signal_lease_context()` and leaves the applied legacy RPC untouched. The new route always acquires a lease, with no fallback. SQL201 and real authenticated PostgREST exercise the exact old strict decoder and zero leaked legacy leases. This is contract evidence, not an old compiled-runtime/media pass. Drain native live calls before app rollback to7aa.

Other reproduced defects: notification loaded-feed truncation, overlapping/stale opening responses and module masking dropping aggregate counts; manager operator authority checked before lock waits. Those are fixed and covered. Earlier CI failures were stale navigation/deep-link expectations, UTC-minute fixture timing, Owner override semantics, nonexistent task column and final fixture actor/completion metadata; fixtures were corrected without weakening controls. Detailed chronology is retained in [the task handoff](woad-orders-calls-ux-20261104.md).

Historical accepted evidence at exact90b94748, not a pass for the new delta:

- [Full seven-job PR gate, attempt2](https://github.com/UplineTonyuo/wolf-forge-platform/actions/runs/41875532489/attempts/2): **389 files/4612 JS tests**, full TypeScript/lint, compiled Next/PDF trace, history secrets, dependency and database jobs passed.
- [Database-only run](https://github.com/UplineTonyuo/wolf-forge-platform/actions/runs/41874419624), repeated in full PR: **167 files/7223 pgTAP assertions**, full DB lint, real Auth/PostgREST/Storage probes, **24 physical overlapping-transaction races**,6 baseline DoW reproductions,2 early-denial probes and UTC rollover passed. SQL203–205 cover manager eligibility/replay/audit/module/edit denials/revocation, native authorization/pilot/busy/budget/replay/races and notification opening/later-arrival races.
- Preserved transport run: legacy decoder; real synthetic Auth → compiled HTTP/SSE → private Realtime → fresh state/history/deep links; native/linked targets; permitted Owner/Admin/Manager/Staff and pilot exclusion; manager persistence/audit/revocation;151 notifications/open/replay/later arrival;3tabs/fourth429/renew/disconnect/replacement/revocation passed. CI-only Daily stub blocks provider requests. No real calls/emails/media/OS delivery were tested.
- Local compatibility regression RED8failed/6passed then **14passed**. TypeScript2048MiB, changed lint1536MiB, whitespace and harness syntax passed. Inclusive tracked+untracked redacting scan **0/2336**, no weakening/exclusions. Historical earlier counts are not additional fresh passes.
- Existing production dependency gate is high/critical; it passed with **5 moderate transitive Sentry/glob/minimatch findings remaining**. Dev-inclusive install summary:26 findings,22moderate/4high. No dependency/threshold change.
- Local full build skipped at recorded1956MiB free RAM, below5.5GiB guard; CI builds passed. Browser widths and two-person media remain owner QA. No local Docker or app closures.

Last recorded production read-only receipts (not rerun for this local correction): Supabase `jwynqsyirgenqlmkooah` has **207 migrations through20261103161636**, manager/opening tables absent, no temporary backup role and pilot2. Approved pair active with active memberships at that readback; no roles/recipients changed by this task. All207 historical SQL representations/checksums reconciled; no applied historical migration edited. Exactly10 source migrations remain **UNAPPLIED**, with the notification body now changed locally and requiring fresh validation/review, in order:

1. `20261103224913_ticket_call_media_admission.sql`
2. `20261103225140_ticket_call_request_throttles.sql`
3. `20261103225229_ticket_call_duplicate_evidence_noop.sql`
4. `20261103225252_ticket_call_history_record_limits.sql`
5. `20261103225401_ticket_call_retained_device_limits.sql`
6. `20261103225429_ticket_call_stream_leases.sql` (unapplied compatibility correction)
7. `20261103231409_project_task_create_replay_authorization.sql`
8. `20261104130000_client_manager_assignment.sql`
9. `20261104131000_order_call_targets.sql`
10. `20261104132000_notification_opening_snapshot.sql`

[WOAD](https://wolf-forge-platform-woad.vercel.app) remains `dpl_hLstfmZUqRVvojtkQoiGZ6hJhjDN`, serving7aa06cf, in WolfForge project `prj_Ck85gEGOBER55bl84u03P8z4syHM` / team `team_dpPiEJrmZWnVTFiOhfLlVes2`. Exact branch exclusion held: validation pushes created no deployment. No production backup/schema mutation, merge, promotion, customer mutation or real call occurred.

Prepared only: ten source-exact wrappers/alignment templates reviewed with top-level timeouts, transaction markers before locks, serialized call admission, ledger lock,207 fingerprints/prior-wrapper digests and exact one-row alignment. Prepared production preflight uses fixed-host bounded read-only key/domain acceptance and generic logs/no media;9 synthetic cases passed with fake fetch and zero real requests. It has **not executed against production config**. Private DB+Storage backup scripts are reviewed/unexecuted, still pinned to older7118 so they correctly refuse90 until deliberately repinned after resume. No fresh backup/integrity/restore/applied-migration receipt is claimed. Restore prerequisites: this Windows user's DPAPI keys/profile, PG17 tools, authorized target/role mappings and encrypted Storage manifest/object bytes; cluster roles/provider configuration excluded.

After owner resumes: verify included allowance and review/checkpoint the new candidate; run physical baseline RED/candidate GREEN and required affected/final isolated checks for the changed code. Regenerate exact-SHA wrappers/checksums/preflight, then fresh main/ledger/config/binding checks, staging-domain controls and production config preflight; fresh verified private DB+Storage backup/metadata stability/temp-role cleanup; exact ten migrations/receipts; controlled merge and **merge-result** checks/tree/SHA; production-config artifact promotion and non-destructive health. Never promote the placeholder/Studio-QA CI build or stale90 wrappers. Retain old deployment for rollback; drain native calls and preserve cleanup/holds/history, no destructive DDL reversal.

Owner manual QA after pilot-limited release, synthetic fixtures only and media only between Sundaysblox647@gmail.com / filamrush@gmail.com:

- Team `https://wolf-forge-platform-woad.vercel.app/orders/<orderId>`; client `/account/projects/<orderId>`: native versus real linked Ticket, permitted roles/assignment, cross-tenant/company denial, pilot exclusion, busy/budget/replay, ringing/accept/decline/cancel/timeout/reconnect/minimize/end/device release, audio/video/history. `/calls/<callId>` and `?call=<callId>`/missed notifications reach the correct conversation.
- Client `/account/messages/<ticketId>`; team `/tickets/<ticketId>?inbox=tickets&ticket=<ticketId>`: genuine client versus support, separate sanitized history/current/prepare HTTP codes, support explanation/no impersonated calls, title pill absent/summary intact. Genuine-client production defect remains unverified.
- Client `/account`: >50 unread/module masks, explicit click/keyboard versus hover/mount, opening during load, later arrivals, overlaps, acknowledgment failure/same-key retry, expiry/revocation, badge persistence and Unanswered independence.
- Team `/clients`: account scope, active same-workspace manager, reload persistence/audit once, partial failures, foreign/revoked manager and module/edit denial, revocation races/100 bound. No real-customer assignment as QA.
- Tasks: empty/long text, labels/input/button alignment, validation/delayed save/stable-ID retry/progress refresh. Widths320/360/390/430/768 and1280/1440, menus/focus/Escape/touch. Operations hidden; direct `/todo` permissioned.

Vault remains read-only. Exact-content memory-steward proposal, **NOT APPLIED**, for owner approval while preserving unrelated text:

- `AI Memory/01 Current State.md`: Orders/calls/Clients UX baseline90b94748 is committed/pushed. Its executed CI4612JS/7223SQL/24 physical races and transport41877061435 passed, but did not cover the original first-opening/backdated-producer race. Local row/version snapshot correction and expanded physical regressions are uncommitted and SQL-unexecuted. Owner holds dispatch/deployment. Production remains at last recorded207 migrations/7aa06cf WOAD,10 pending migrations; new-candidate validation and all release gates remain. No pilot expansion or production test mutation.
- `AI Memory/03 Implementation Log.md`: 2026-11-05 — Codex —90b94748 executed cases passed4612JS/7223SQL/24 races and Auth/Realtime/SSE, but same-ID notification replay did not cover NEW first-opening/backdated-producer publication. Prepared single-statement admission/snapshot and exact row-version update, plus original-baseline/candidate physical cases for recipient/rate/row waits and SQL205 same-xmin refresh. Local UI compatibility17tests passed; physical SQL RED/GREEN unexecuted. Owner hold, production/schema/backup unchanged, manual media pending.
- `AI Memory/02 Decisions.md`: Selected Clients rows are accounts; manager assignment applies to selected accounts, covering contacts as account metadata, without contact mutation/access grants. Native calls use explicit order targets; real linked Tickets retain legitimate mapping.
- `AI Memory/05 Architecture Map.md`: Candidate-only until release: tenant-bound XOR order/Ticket call target and separate lease-context RPC; private account-manager metadata independent of authorization; complete notification counts/replay receipts. Original first-opening backdated-publication gap found at90b94748; local pre-wait row/version snapshot correction and physical counterexamples prepared but SQL-unexecuted. Production has not applied these migrations.
- `Security/17 Security Change Log.md`: 2026-11-05 — Codex —90b94748 passed its isolated RLS/race/transport cases while retaining an uncovered first-opening notification race. Local correction preserves eligibility/quota/replay/count controls and prepares row-version/admission-wait regressions; SQL execution remains pending. Ten migrations unapplied. Prior green receipts remain historical exact-SHA evidence, not new-code acceptance. Owner hold and fresh validation/backup/preflight/controlled-rollout gates remain; browser/media unperformed.

Current local edits include the notification migration, SQL205, physical harness/baseline fixture and both handoffs. They remain uncommitted/unpushed under the hold. The committed-source ZIP below is historical, before this correction: TEMP `wolf-forge-orders-calls-20261104/source-90b94748.zip`,56 hash-verified entries, SHA256 `181E82AD3A31A40FDA6DE7452651B27FB0F4FB5BA819AB38707CD8C002CF9EA2`. No automatic compaction configured. Private receipts remain local; no credentials/dumps/customer data in Git/CI/chat.

The following56-path list is the committed90 task diff, not a new candidate manifest. The correction additionally adds [the exact90 baseline fixture](<../supabase/tests/fixtures/notification_opening_90b94748.inc>) and edits the existing migration/SQL205/harness/handoffs. Historical first-handoff details below are preserved as history, not current test results.

- [.github/workflows/security.yml](<../.github/workflows/security.yml>)
- [docs/woad-orders-calls-ux-20261104.md](<../docs/woad-orders-calls-ux-20261104.md>)
- [docs/woad-orders-calls-ux-final-20261104.md](<../docs/woad-orders-calls-ux-final-20261104.md>)
- [scripts/qa/check-ticket-call-transport.mjs](<../scripts/qa/check-ticket-call-transport.mjs>)
- [scripts/qa/stub-call-provider.mjs](<../scripts/qa/stub-call-provider.mjs>)
- [scripts/qa/ticket-call-concurrency.mjs](<../scripts/qa/ticket-call-concurrency.mjs>)
- [src/app/(internal)/clients/page.tsx](<../src/app/(internal)/clients/page.tsx>)
- [src/app/account/messages/[ticketId]/page.tsx](<../src/app/account/messages/[ticketId]/page.tsx>)
- [src/app/actions/clients.ts](<../src/app/actions/clients.ts>)
- [src/app/actions/notifications.ts](<../src/app/actions/notifications.ts>)
- [src/app/api/ticket-call-events/route.ts](<../src/app/api/ticket-call-events/route.ts>)
- [src/app/api/ticket-calls/route.ts](<../src/app/api/ticket-calls/route.ts>)
- [src/app/calls/[callId]/page.tsx](<../src/app/calls/[callId]/page.tsx>)
- [src/components/account/client-notification-bell.tsx](<../src/components/account/client-notification-bell.tsx>)
- [src/components/calls/call-controller.ts](<../src/components/calls/call-controller.ts>)
- [src/components/calls/call-prepare.tsx](<../src/components/calls/call-prepare.tsx>)
- [src/components/clients/clients-table.tsx](<../src/components/clients/clients-table.tsx>)
- [src/components/projects/project-detail.module.css](<../src/components/projects/project-detail.module.css>)
- [src/components/projects/project-tasks.module.css](<../src/components/projects/project-tasks.module.css>)
- [src/components/shell/nav-registry.ts](<../src/components/shell/nav-registry.ts>)
- [src/components/tickets/order-conversation.tsx](<../src/components/tickets/order-conversation.tsx>)
- [src/components/tickets/project-conversation.tsx](<../src/components/tickets/project-conversation.tsx>)
- [src/components/tickets/ticket-call-controls.tsx](<../src/components/tickets/ticket-call-controls.tsx>)
- [src/components/tickets/ticket-client-conversation.tsx](<../src/components/tickets/ticket-client-conversation.tsx>)
- [src/components/tickets/use-ticket-call-history.ts](<../src/components/tickets/use-ticket-call-history.ts>)
- [src/domain/notifications/visibility.ts](<../src/domain/notifications/visibility.ts>)
- [src/domain/tickets/call-entry.ts](<../src/domain/tickets/call-entry.ts>)
- [src/domain/tickets/calls.ts](<../src/domain/tickets/calls.ts>)
- [src/lib/supabase/database.types.ts](<../src/lib/supabase/database.types.ts>)
- [src/repositories/company-repository.ts](<../src/repositories/company-repository.ts>)
- [src/services/company-service.ts](<../src/services/company-service.ts>)
- [src/services/ticket-call-service.ts](<../src/services/ticket-call-service.ts>)
- [src/tests/call-events-route.test.ts](<../src/tests/call-events-route.test.ts>)
- [src/tests/call-recipient-picker.test.tsx](<../src/tests/call-recipient-picker.test.tsx>)
- [src/tests/client-manager-actions.test.ts](<../src/tests/client-manager-actions.test.ts>)
- [src/tests/client-notification-opening.test.tsx](<../src/tests/client-notification-opening.test.tsx>)
- [src/tests/client-opening-actions.test.ts](<../src/tests/client-opening-actions.test.ts>)
- [src/tests/clients-table.test.tsx](<../src/tests/clients-table.test.tsx>)
- [src/tests/frontend-shell.test.ts](<../src/tests/frontend-shell.test.ts>)
- [src/tests/internal-shell-navigation.test.tsx](<../src/tests/internal-shell-navigation.test.tsx>)
- [src/tests/operations-navigation-hidden.test.ts](<../src/tests/operations-navigation-hidden.test.ts>)
- [src/tests/order-call-target.test.ts](<../src/tests/order-call-target.test.ts>)
- [src/tests/ticket-call-controls.test.tsx](<../src/tests/ticket-call-controls.test.tsx>)
- [src/tests/ticket-call-history-sync.test.tsx](<../src/tests/ticket-call-history-sync.test.tsx>)
- [src/tests/ticket-call-route.test.ts](<../src/tests/ticket-call-route.test.ts>)
- [supabase/migrations/20261103225429_ticket_call_stream_leases.sql](<../supabase/migrations/20261103225429_ticket_call_stream_leases.sql>)
- [supabase/migrations/20261104130000_client_manager_assignment.sql](<../supabase/migrations/20261104130000_client_manager_assignment.sql>)
- [supabase/migrations/20261104131000_order_call_targets.sql](<../supabase/migrations/20261104131000_order_call_targets.sql>)
- [supabase/migrations/20261104132000_notification_opening_snapshot.sql](<../supabase/migrations/20261104132000_notification_opening_snapshot.sql>)
- [supabase/tests/database/198_ticket_call_followups.test.sql](<../supabase/tests/database/198_ticket_call_followups.test.sql>)
- [supabase/tests/database/199_ticket_call_cost_controls.test.sql](<../supabase/tests/database/199_ticket_call_cost_controls.test.sql>)
- [supabase/tests/database/201_ticket_call_stream_leases.test.sql](<../supabase/tests/database/201_ticket_call_stream_leases.test.sql>)
- [supabase/tests/database/203_client_manager_assignment.test.sql](<../supabase/tests/database/203_client_manager_assignment.test.sql>)
- [supabase/tests/database/204_order_call_targets.test.sql](<../supabase/tests/database/204_order_call_targets.test.sql>)
- [supabase/tests/database/205_notification_opening_snapshot.test.sql](<../supabase/tests/database/205_notification_opening_snapshot.test.sql>)
- [vercel.json](<../vercel.json>)

## Historical first handoff

Candidate committed/pushed on `codex/woad-orders-calls-ux-20261104`: source `2f15b1e`, integrated checkpoint `1c306eb`, based on preserved `7e011865`. The following behavior table and local totals are historical; the current release evidence above supersedes them.

| Item | Behavior and principal changed files |
|---|---|
| Order calls | Both `order-conversation.tsx` and `project-conversation.tsx` use the shared controls, preparation, controller and history. Explicit native-order RPCs reuse the call ledger; legacy orders resolve real Tickets. `calls.ts`, `ticket-call-service.ts`, `call-entry.ts`, `/calls/[callId]/page.tsx` and migration `20261104131000_order_call_targets.sql` carry authorization/deep links. Pilot restrictions, lifecycle and cost controls remain. |
| Tasks | `project-tasks.module.css` and `project-detail.module.css`: padding, wrapping, headings and responsive input/button alignment; task behavior preserved. |
| History failure | `ticket-calls/route.ts`, `use-ticket-call-history.ts`, `ticket-client-conversation.tsx`: support 403 has explanatory nonretry UI; session 401, quota 429 and service 503 remain distinct. Late responses cannot overwrite another conversation. |
| Duplicate pill | `/account/messages/[ticketId]/page.tsx`: removed only the header status pill; summary/status retained. |
| Notifications | `client-notification-bell.tsx`, `actions/notifications.ts`: explicit managed/unmanaged opening marks its existing snapshot, with acknowledged bounded mutations and recovery. Hover does not mark read; later arrivals and overlapping openings are preserved. |
| Manager assignment | Clients page/table/actions, company service/repository, database types and migration `20261104130000_client_manager_assignment.sql`: persisted account-level assignment, active same-workspace manager checks, edit/module permission, audit, per-account results and authoritative refresh. No access grants. |
| Operations | `nav-registry.ts`: hidden from shared navigation; routes, titles, workflows and permissions retained. |

The [detailed handoff and complete changed-file/test inventory](C:/Users/TrojanNiAnton/.codex/worktrees/spp-security-fixes-20261104/woad-voice-release-20261026/docs/woad-orders-calls-ux-20261104.md) includes evidence and commands.

Checks passed: **199 tests/34 files**, then **141 tests/5 files** (three overlapping tests); typecheck, full lint, final changed-file lint, whitespace and inclusive secret scan. Source review has no remaining concrete findings. New SQL 203/204 cover isolation, eligibility, persistence/replay and native-call admission, but **were not executed**.

The support 403 behavior was reproduced with synthetic sessions. No genuine-client production failure was reproduced. Local Supabase and Daily configuration are absent; live pilot/configuration, RPC compatibility and real-session transport remain unverified.

SQL/RLS/concurrency and browser/media QA remain pending. Full build was skipped at **3.91 GiB available**, below the **5.5 GiB** guard. Vault notes stayed read-only. No commit, push, deployment, hosted migration or real calls/customer mutations occurred. A verified source checkpoint was saved; automatic compaction was not configured.

Manual QA on the authorized synthetic local server (usual base `http://127.0.0.1:3000`):

- `/orders/<id>` and `/account/projects/<id>`: native/legacy orders, permitted team roles/client, cross-tenant/company denial, pilot exclusion, recipient selection, full call lifecycle/history and `/calls/<callId>` deep links.
- `/account/messages/<id>`: genuine login versus administrator support, sanitized history/current/prepare errors, preserved summary status.
- `/account`: hover versus click, initial-load/opening races, later arrivals, overlapping 50-row snapshots and failed read/retry; Unanswered unchanged.
- `/clients`: assignment/reload persistence, audit, partial failures and foreign/revoked manager/edit denial. Check task layout and menus at 320/360/390/430/768/1280/1440px; Operations hidden while direct `/todo` remains intact.

Final report copied to clipboard.

Skills used: systematic-debugging, security-and-hardening, ui-ux-pro-max, impeccable, ponytail, react-best-practices, using-superpowers, using-git-worktrees, brainstorming, writing-plans, test-driven-development, verification-before-completion, requesting-code-review.
