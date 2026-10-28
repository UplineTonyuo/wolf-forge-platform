# Calling v1 Phase 1 — amended foundation brief

29 October 2026. **Reviewable specification, not delivered behavior or implementation approval.** This amendment is reconstructed from the supplied seven-finding audit; the underlying earlier Phase 1 brief was not present in the conversation or searched task files. It preserves the audit's stated scope and names proposed choices where the audit left alternatives. Read it before any implementation request.

Target: existing `codex/woad-live-calls-20261026`, draft PR #76. Verified starting checkout: clean `675607fe2eb0a2f9ddfe2b21cd429614ca1b0a0f`; local merge `bcc8086`. Fresh remote reads: main `205214bae3a965384e1974bcd64915911ea1eefe`, PR head `4d4b8909ab6e3640c9d9957b910f2d199130daf7`, PR open/draft. Canonical memory remains read-only; D-307 is the existing general calling request, not evidence that Phase 1 was approved or implemented. The old platform-pwa Daily pilot remains superseded.

## Phase boundary and supersession

Phase 1 supplies server/database authority for private two-person Ticket calls in both directions: one selected recipient, 40-second invitation, atomic acceptance/session binding, bounded usage reservations, cleanup, 12-month private history and a four-number owner query. It also defines a generic future push contract. Provider calls and evidence ingestion are tested with fixtures/adapters while real integration remains disabled. This foundation does not satisfy the eventual full incoming-call experience on its own.

Do not implement incoming-call UI, ringtone, Realtime signalling subscriptions, push enrollment/dispatch, business-hours machinery, a reporting UI or a multi-recipient fanout system in this phase. Preserve fixed room expiry and disabled recording, transcription, screen share, phone dialing and group/observer participation.

This brief **supersedes the earlier [full design](design.md) for Phase 1** wherever they differ:

| Earlier proposal | Phase 1 contract |
| --- | --- |
| Ring all authorized team members for unassigned Tickets | Exactly one selected team member; configured eligible owner fallback; never broadcast |
| Refuse an invalid assignee without fallback | Resolve the configured owner fallback when the assignee is missing/ineligible; otherwise refuse safely |
| Separate test/production Daily accounts as a release prerequisite | Treat test and production as sharing one account allowance until proved otherwise; enforce disjoint allocations under one combined maximum |
| Business-hours settings | Entirely deferred; no unused settings/schema |
| 90-day detail / 13-month aggregate retention | 12-month history, with narrow unresolved-accounting holds retained until reconciled |
| Incoming UI, Realtime and actual push in the first delivery slice | Deferred beyond this foundation; only the private invitation/read/command and generic payload contracts belong here |
| Owner reporting interface | One owner-only server query returning four values; UI waits |

No item in the earlier full design can silently reintroduce ring-all, device takeover, separate full account allowances or the old retention deletion. The historical merge/test report remains historical evidence for its tested source, not Phase 1 acceptance.

## Audit findings mapped to mandatory acceptance

| Finding | Required result before Phase 1 is accepted |
| --- | --- |
| 1 — Shared budget | Combined account allocation cannot exceed 6,000 participant-minutes/month; reserve before room creation, retain uncertain holds, split month boundaries and reconcile non-product account use |
| 2 — Old admission bypass | Old reserve/join/status/token paths are removed or routed through the same new participant/flag/device checks; wrong authorized viewers cannot take an empty slot |
| 3 — Cleanup under revocation | Ticket closure, module/reply permission loss, membership revocation, tenant flag OFF and breaker OFF cannot prevent bounded participant termination/trusted cleanup |
| 4 — Accepted versus answered | Acceptance never establishes an answer or connected seconds; trusted two-party presence does; all participant seconds count against usage |
| 5 — Deadline/retention job | Named bounded server jobs finalize silent calls and 12-month retention; acceptance checks the exact deadline independently of the scheduler |
| 6 — Real concurrency | Disposable CI executes genuinely overlapping database sessions for the specified races, with explicit winner/effect assertions |
| 7 — Owner fallback | Exactly one explicitly configured, currently eligible fallback owner; multiple owners never imply unordered selection or broadcast |

## Single-recipient policy

Resolve Tenant, caller, owning client, assignee and fallback from persisted rows under current authorization; never accept a caller-supplied callee. Freeze `caller_profile_id`, `callee_profile_id`, direction, mode and Ticket/Tenant on the admitted call. Changing assignment after admission cannot redirect an existing invitation. Every command rechecks the frozen actors' current eligibility.

* **Client -> team:** require current Ticket/linked Order authority and an eligible client caller. Proposed conservative rule: the caller must be the Ticket's `client_profile_id`; same-company Ticket visibility alone is not enough to initiate or join a call. Select an active authorized assigned internal member; if absent, archived, wrong-Tenant or no longer authorized, select the configured fallback owner. An already busy eligible assignee yields busy rather than an automatic new recipient.
* **Team -> client:** require current team reply authority; select exactly the Ticket's active owning `client_profile_id` in the correct Tenant/Company. Guest/Company-only Tickets without that identity refuse calling; do not substitute another Company member or infer identity from email.
* **Fallback owner:** use one private Tenant setting, `calling_fallback_owner_profile_id`, default NULL. It must name an active internal owner in this Tenant who currently has Ticket and linked Order reply authority. A NULL/ineligible/busy fallback refuses with a neutral unavailable result. Never pick the first owner from an unordered query or fall through to another owner automatically. Setting it is a separately authorized owner/operator operation; no settings UI or identity change is part of this document.

The configured-owner rule resolves audit finding 7 without a multi-recipient schema. The particular fallback identity is intentionally unset until the owner chooses it. The stricter client-initiation rule and busy behavior above are explicit proposals for review, not existing settled policies.

## Admission and state authority

Postgres owns transitions, server timestamps, participants, version and limits. Minimal invitation states: `ringing -> accepted -> connecting -> active -> ending -> ended`, with direct terminal transitions from ringing/accepted/connecting. Room setup lifecycle may remain separate. At most one admitted nonterminal call per Ticket and one claimed live call per participant; use declarative unique constraints plus consistent lock ordering, not browser check-then-write.

Store requested/ring/deadline/accepted/first-two-party-answer/termination-request/effective-end/finalization times separately. Set `ring_deadline = ring_started_at + 40 seconds` once. A successful accept atomically requires ringing state, `clock_timestamp() < ring_deadline`, the selected callee, current authority/flag, and a winning session/device claim. Recompute time after any blocking lock; a timestamp captured before waiting must not authorize a late accept. The accepted/setup deadline is 45 seconds after acceptance, bounded by immutable room expiry. Retry, reload and device changes cannot extend deadlines.

Bind idempotency to caller, Tenant, Ticket, mode and original request ID. If both directions initiate at once, one invitation wins; the other side may read its permitted existing incoming state and explicitly Accept. Two Call clicks never imply acceptance. Same-payload retry returns the same authorized attempt; changed-payload reuse conflicts.

Two devices accepting must contend on the same call row and participant claim. Exactly one session/device lease wins. Bind meeting-token issuance and reissuance to that lease and the correct frozen participant; caller tokens also have a single session/device binding. Unique Daily user IDs supplement this rule but cannot authorize takeover. Losing devices get a neutral already-taken result and no token. Accept versus cancel is serialized on the same row; setup/token completion rechecks the final state after an uncertain provider boundary.

Admission requires all applicable current session, Tenant membership, Company, published modules, Ticket/linked Order access and reply rules. Add a private Tenant calling-enabled flag, default OFF, plus the existing server/provider switch. Every reserve, accept, join, status projection and token issuance enforces its appropriate flag and participant authority. Browser visibility and supervision never confer media participation.

Inventory and close every legacy entry point, including direct `public.app_ticket_call`, `app_complete_ticket_call_setup`, `joinTicketCall`, `callOperation`, `/api/ticket-calls` GET/POST/DELETE, and both existing Ticket control callers. Old Join cannot silently reserve, accept or select a second participant. Preserve a guarded compatibility response or disable old controls while the new UI is deferred; never leave two independently authorized admission APIs. Revoke obsolete RPC execution paths where replacement is chosen. Do not break ordinary Ticket messages or current history access when calling is off.

## Termination is a separate, narrow permission

Admission/read guards must not run before participant-bound termination. A verified signed-in identity bound to a frozen participant may request termination of that call without needing an open Ticket, a still-enabled module, current reply ability, a current membership or the calling-enabled flag. Return only a content-free termination receipt; do not grant Ticket reads or arbitrary room lookup. Session validation remains real authentication; a revoked session does not become trusted because a call ID is known.

A trusted bounded cleanup job handles membership/profile/session revocation, tenant suspension/flag OFF, provider breaker OFF, closed/archived Tickets and disconnected clients independently of user RPC permission. Feature OFF blocks new setup/tokens but leaves cleanup credential access and provider ejection/deletion available to the trusted path. Do not reuse `readDailyCallConfig()`'s enabled check as the cleanup gate. Unknown or failed cleanup keeps durable work and budget reservations; do not report provider termination from browser teardown or an HTTP success alone.

Use durable, idempotent room creation/end claims and deterministic room names. Fresh-read the exact room after uncertain creation before retrying; never create a differently named replacement blindly. Separate logical termination request from observed provider end, preserving any solo or overlapping usage during cleanup delay. Fixed 15-minute room/token expiry, ejection at expiry, two participants and disabled extra media/phone capabilities remain the final bound; no extensions or quota resets for QA.

## Combined account budget

Use the simpler permitted option: **fixed disjoint environment allocations**, with atomic reservations inside each environment database. This avoids a new central cross-database service or production database access from Studio. The proposed total is **6,000 participant-minutes = 360,000 participant-seconds per UTC month**. Initial proposed split: Studio/test **600 minutes**, production **5,400 minutes**. Those two numbers are review choices; until an allocation is installed and the backend identity verified, admission remains OFF.

Bind allocations to an operator-controlled provider-account identifier, environment identity, expected Supabase backend and policy version. A client, Tenant owner or arbitrary server request cannot select an environment or increase its allocation. A cloned/restored database remains calling-OFF until its environment/account binding and allocation are independently revalidated. There may be only one enabled database for each allocated environment slot; additional previews share the Studio slot's authority or remain OFF, rather than each receiving another copy of 600 minutes. Prefer the same synthetic Studio backend across branch previews; never test by mutating production.

Within each environment, a locked monthly budget row atomically enforces `reconciled consumption + uncertain holds + active worst-case reservations <= allocation`. Tenant sublimits fit within that same allocation; they are not additional allowance. Reserve up to two participants times the entire remaining room lifetime **before** creating a room/token. A maximum-length call reserves 1,800 participant-seconds. For month-crossing rooms, reserve each month’s portion in the same admission transaction. Caller acceptance, browser hangup, empty current room inventory or a timed-out provider response cannot release a hold. Settlement requires trusted provider evidence; missing evidence keeps the conservative reservation.

Preserve #76's existing actor/global reserve/token/status/end throttles, six new calls/day/caller, eight token attempts/room, four unexpired reservations and conservative room-count ceiling unless a separately tested replacement is approved. Add an invitation-attempt limit so calls which never create a room cannot bypass room-based throttling. Tenant/provider breakers refuse admission while allowing end, reconciliation and cleanup. Persist threshold events for the later alert-delivery phase; no new email/push sends now.

Allocations are immutable for an active accounting month. Reallocation requires a separately reviewed freeze/drain/reconcile procedure that proves the old allocation cannot still be spent before the recipient allocation rises; two unrelated setting writes are insufficient. Account-level reconciliation must include other/unmapped rooms, external/manual usage and other environments. If that use cannot be bounded or imported into the combined allowance, refuse further new rooms until reconciled; do not describe fixed allocations as a provider billing guarantee. [Daily says participant-minutes count each participant and Video has no automatic hard usage cap](https://www.daily.co/pricing/video-sdk/).

## Trusted evidence and reporting semantics

`accepted_at` records consent/claim only. `answered_at` requires trusted evidence that both frozen parties were present in the same meeting at overlapping times. Connected seconds are the union of their overlapping presence intervals, excluding reconnect gaps. Budget/provider usage sums all participant presence, including a caller waiting alone and repeated sessions. Store integer seconds; apply provider rounding separately during reconciliation. UI callbacks, token issuance and user-submitted duration do not certify an answer or cost.

Define an idempotent server-only ingestion/reconciliation service for allowlisted provider account, room/meeting IDs, pseudonymous participant IDs, intervals, evidence IDs and source timestamps. Reject wrong-account/unmapped/wrong-participant evidence and impossible intervals. Persist evidence and corrections with unique event/session keys, tolerate out-of-order/duplicate data, and retain unresolved holds. A later verified connection can correct an estimated pre-answer expiry classification with a fixed audit event; never reopen media access or silently rewrite history. Phase 1 verifies these rules using provider fixtures; no real meeting, webhook registration, fetch, key or background provider request is needed.

[Daily meeting history](https://docs.daily.co/reference/rest-api/meetings/list-meetings) is an available reconciliation source. Live ingestion must be approved and verified before enablement: poll finalized/recent meetings at least hourly and promptly after a call when using REST, backfill overlapping windows idempotently, and alert/refuse new work when evidence approaches the verified account retention window. Do not wait until month end. Provider pricing currently describes short metric/log retention; confirm the account's actual available history in that later phase. [Daily webhooks require a credit card on file](https://docs.daily.co/reference/rest-api/webhooks); do not assume free/unconfigured webhook availability or add a card. If later selected, verify raw-body HMAC, timestamp/replay checks, durable ingestion and handshake configuration before subscribing.

Private call history retains caller, callee, Ticket/Tenant, direction/mode, requested/accepted/answered/ended timestamps, the four required outcomes (`answered/declined/missed/expired`), reason, connected seconds, participant seconds and reconciliation state. No new media, recording, transcript or message content. Timeout while ringing is missed; explicit callee refusal is declined; caller cancellation/setup/connection failure before verified overlap is expired with a reason; any verified two-party conversation remains answered, including a later forced expiry. Accepted-without-media is never answered merely because it was accepted.

The Phase 1 owner-only server query returns **calls made, calls answered, calls missed, total connected seconds** for one authorized Tenant and UTC month. Make all four definitions explicit: admitted attempts count as made; counts are grouped by request month; verified connected intervals are split by actual month boundary. Refused admission is not a made/missed call. Return zero-filled numbers and no raw private data for aggregate-only access; the future UI may format seconds as minutes. Participant-minute budget usage is a separate measure, not one of the four conversation numbers. No owner summary UI or speculative export/reporting subsystem now.

History reads require current participant and Tenant/Ticket authority; a same-company Ticket viewer or supervisor who is not the caller/callee cannot read private call history. The authorized active Tenant owner may query the four-number Tenant aggregate, which does not imply media participation or unrestricted Ticket detail. Specify any owner detailed-history exception separately; default is the narrower participant history. Calling OFF does not erase authorized history or make an aggregate public.

## Named server jobs and 12-month retention

Following `supabase/migrations/20261027123100_order_start_retry_job.sql`, define database-only, bounded functions and conflict-checked named cron jobs. No provider HTTP or new push dispatch is activated in Phase 1.

* `wf-ticket-calls-deadlines-v1`: every **10 seconds**, runs `private.process_ticket_call_deadlines()` over due ringing, accepted/setup and cleanup-revocation records. Claim bounded batches with locks/leases, permit multiple sweeps safely, use exact stored deadlines for effective unanswered end, and create one deduplicated missed bell for the single selected callee if still entitled. A late job cannot permit a late accept. Reuse current notification visibility filtering and give no new Ticket content to a revoked recipient. Catch up after downtime without duplicate outcomes/bells; monitor overdue work. [Second-based schedules require compatible Supabase/Postgres versions](https://supabase.com/docs/guides/cron/quickstart); verify in disposable CI, fail rather than silently install a minute schedule.
* `wf-ticket-calls-retention-v1`: daily, runs `private.prune_ticket_call_history()` in bounded batches. Terminal detailed call/evidence rows become eligible **12 calendar months after effective end**; no 90-day reserve-path deletion remains. Never delete an active call, unsettled reservation, unknown provider mutation or unresolved usage discrepancy. After 12 months retain only minimal accounting linkage necessary for an unresolved hold, record the exception, and delete it through the same bounded process once settled. Apply the same defined horizon to derived data; do not silently introduce a 13-month aggregate policy.

Cron provisioning checks existing schedule/command before reuse and refuses a conflicting name instead of overwriting it. Bound retained cron-run history. Local browser requests/timers may refresh state but are not the sole finalizer, cleanup or retention mechanism.

## Private storage and entry-point requirements

Extend/reuse `private.ticket_calls` rather than introducing a ring-all recipient model. Add only the fields/constraints and private tables required for one frozen callee, winning session/device, append-only evidence, participant claims, monthly reservations and durable cleanup. A single generic future delivery intent is sufficient; do not introduce multi-recipient routing/fanout/Realtime infrastructure in this phase.

Enable/force RLS where applicable, revoke direct client table access, and expose bounded typed RPC projections. Explicitly revoke default PUBLIC execution on privileged functions, use empty search paths, and grant trusted ingestion/job helpers only to the specific trusted role. A service-role key does not let browser data choose a room, participant, account or budget. Protect history and owner queries against cross-Tenant/Company/record guessing, archived identities, suspended Tenants and stale role claims. Tenant flag, allocation and fallback writes are separately authorized and audited, not browser table writes.

The future push contract permits only fixed text **“Incoming call from Wolf Forge”**, a generic instruction, an opaque call ID/version and bounded same-origin call destination. It grants no authority and contains no Ticket number/title, client identity, message, room URL, token or secret. Actual subscription enrollment, worker changes, push sends, click routing UI and ringtone belong later. A payload-schema fixture can test the contract now; do not register a worker or send a notification to prove a contract test.

## Migration and environment sequence

1. **Before editing a migration in a later authorized implementation**, fresh-fetch/read `origin/main`, enumerate its migration names and choose CLI-generated timestamps strictly after its latest timestamp with zero collisions. The presently observed latest is `20261028123000`; never reuse that observation without rechecking. Compare against Git only in Phase 1.
2. The audited source plan allows re-dating the original `20261026123450_ticket_live_calls.sql` base migration with **unchanged SQL body**, followed by a separate new foundation upgrade migration. Fresh disposable CI applies main, the re-dated base and the upgrade in that order. Do not quietly replace CREATE TABLE with permissive IF NOT EXISTS to conceal drift. No migration rename or SQL was made by this documentation task.
3. **Phase 2 only, after explicit authorization:** inspect Studio's exact old schema, function bodies/owners/ACLs and the precise migration ledger row. Prove old/new base SQL equivalence before aligning that one existing version; preserve every unrelated row, history payload and checksum. Do not replay CREATE TABLE over an existing table, blindly delete history or claim ledger equivalence from matching table names. Refuse drift and produce a reviewed recovery plan instead.
4. Local `environment-proof.json` proves the local helper's Studio reference only. Before any hosted runtime test, separately inspect effective branch-specific Vercel Preview variables privately, identify which Supabase project they select and whether overrides win, and save only redacted identity evidence. A Preview deployment is not automatically isolated. If its effective backend is production, stop synthetic mutations; do not alter the variables in this phase.
5. No production database access/migration, Studio change, production Daily key, call, provider mutation, deployment, server launch or RojanCRM work follows from this amendment. No Docker on this PC. Disposable CI containers are an expressly defined requirement of a later authorized Phase 1 CI run, not permission to start local Docker or dispatch a workflow now.

## Required tests and acceptance evidence

Sequential pgTAP proves constraints, authorization, replay and edge cases. It does **not** prove concurrency. Add a deterministic CI-wired two-session harness (the existing `supabase/tests/isolation` convention with PostgreSQL `isolationtester`, or a verified equivalent using separate connections). Use barriers/controlled lock overlap, committed outcomes and native assertion failures; repeated sequential RPC calls or Promise.all against one transaction are insufficient. Pin/verify the available runner in the disposable database CI job, wire it to run after migrations, and fail if the runner/specs are skipped or missing. Do not claim the existing sequential suite 165 covers these races.

| Acceptance case | Assert persisted effects, not just HTTP results |
| --- | --- |
| Two devices accept the same invitation concurrently | Exactly one frozen callee session/device and participant claim; loser gets no token or replacement room |
| Accept races caller cancel | One legal serialized outcome; no token/setup after cancellation wins; no duplicate budget consumption |
| Opposite-direction simultaneous initiation | One live Ticket invitation and idempotent existing-call result; no implicit accept |
| Concurrent final-budget admissions | At most the affordable reservations commit; account allocation/summed Tenant limits remain bounded |
| Same participant accepts different Tickets | Unique live claim; one admission, no second token or duplicate room |
| Wrong staff/same-company client before the vacant slot fills | Reserve/accept/join/status/token legacy and new APIs refuse participation; general Ticket visibility is not enough |
| Winning profile on a different session/device | No takeover or token renewal without the original lease; caller device obeys the same rule |
| Ticket close/archive, module/reply loss, membership/session revocation, Tenant OFF/breaker OFF mid-call | New admission fails; content-free authorized end or trusted cleanup still progresses; uncertain provider usage remains reserved |
| Two/missing/ineligible fallback owners | Only the configured eligible owner is chosen; NULL/ineligible configuration fails predictably; no broadcast/unstable ordering |
| Clock and scheduler boundaries | Accept is denied at/after 40 seconds even after waiting on a lock; no-browser sweep finalizes once; accepted/setup timeout and catch-up behavior are bounded |
| Presence accounting fixtures | Accept/no microphone, solo waiting, overlapping intervals, reconnect gaps, duplicates, wrong participant/account, late/out-of-order evidence, unknown cleanup and corrected classification |
| UTC rollover and allocations | Both months hold their worst-case portions; two environment maxima plus any additional allocation never exceed the combined cap; cloned/extra preview binding fails closed |
| Retention | Keep <12-month/active/unresolved evidence, delete eligible settled >12-month records in bounded batches, retain then settle minimal accounting holds |
| Four-number owner query and private history | Correct zero/month/Tenant semantics; non-owner aggregate denied, nonparticipant detail denied, cross-Tenant/Company leak denied; enabled flag OFF retains permitted history |
| Generic push contract | Fixed generic text and opaque ID only; no dispatch, subscriptions, worker enrollment or Ticket/media secrets |

Before Phase 1 acceptance, run typegen/typecheck, strict lint, full Vitest, disposable CI database/RLS tests **and actual two-session specs**, QA production build under existing resource guards, dependency audit and secret scans on the exact source. Publish no credentials in logs. Preserve generated config bytes and verify the final tree. Use the existing draft PR for CI only after an explicit authorized push; the earlier no-push constraint is not overridden by quoting this audit.

This document adds no new tests and claims no fresh application/database/provider pass. Prior local 3,744-test receipt and the audit's later 51 focused tests are historical and have different scopes. Incoming UI, real two-way media, lock-screen notifications and physical Windows/Android/iPhone acceptance remain later gates. Keep PR #76 draft; do not merge, deploy, change Studio or start Phase 2 from this brief.

## Review choices still requiring a decision

Confirm the intended original Phase 1 brief if it contains requirements absent from the audit; approve or adjust the proposed 600/5,400 allocation split; name the fallback owner; confirm Ticket-owning-client initiation and busy behavior; confirm the four summary definitions and retained accounting exceptions. These are configuration/contract decisions, not facts about current code. Once the amended brief is accepted and implementation explicitly requested, implement only the foundation on the existing branch and prepare its draft PR checks within the authorized push/CI scope.
