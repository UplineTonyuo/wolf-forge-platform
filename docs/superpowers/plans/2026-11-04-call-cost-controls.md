# Call cost-control repairs

**Goal:** Repair CALL-DOW-01/06/03/04/05/02 from the two November 4 audits, in that order, in the existing worktree at baseline `7aa06cf`.

**Architecture:** Keep database authority and existing claims, quotas, receipts and provider reconciliation. Add early shared admission, bounded durable ingress and expiring database stream leases. No new dependencies or provider calls.

**Authorization:** Owner explicitly requested these six repairs, focused regressions and separate logical local commits. Implement inline; no new worktree. Storage/connection values were proposed in chat before implementation and used as defaults after independent work; no owner reply or additional approval is inferred. Vault is read-only; steward proposals go under `../../outputs/call-cost-controls-20261104/`.

## Steps

- [ ] CALL-DOW-01: Add ready-room/exhaustion and throttle regressions to provider boundary and media-route tests, plus isolated SQL tests. Check exhaustion and retry admission in every setup branch; skip repeat lookup of a durably verified ready room. Preserve new/uncertain create and join reauthorization. Return 429 with Retry-After for shared throttles. Commit independently.
- [ ] CALL-DOW-06: Charge authenticated invitation/command requests before the global call lock/deadline sweep; preserve matching replay, conflict checks and cleanup while admission is off. Test early refusal and matching replay in SQL; add race coverage to guarded CI harness. Commit independently.
- [ ] CALL-DOW-03: Once values approved, bound all new history records (including busy/refused) under existing serialization, after exact replay. Cover day/30-day actor/account limits, no partial rows/reservations and concurrency. Commit independently.
- [ ] CALL-DOW-04: Once values approved, cap retained push device rows under existing profile lock, including disabled/expired rows. Keep endpoint ownership and delivery receipts. Test disable/re-enable, retention and concurrent fresh endpoints. Commit independently.
- [ ] CALL-DOW-05: Identical incomplete evidence returns before aggregate/version/event writes; conflicts still fail and later completion still settles. Extend actual SQL evidence tests. Commit independently.
- [ ] CALL-DOW-02: Once values approved, acquire/renew/release session/profile-scoped expiring leases before channel opening. Close and release on abort, cancellation, subscribe/auth/renew failure and TTL. Cover simultaneous tabs, stale renewals, expired leases and cleanup in application/SQL/race tests. Commit independently.
- [ ] Run focused Vitest with one worker/768 MiB heap, scoped lint and bounded typecheck. Build only above existing 5.5 GiB free-RAM guard. Run secrets check. Review entire diff, exact tests and unexecuted acceptance.
- [ ] Prepare concrete isolated validation against this committed tree. Check Actions allowance before any run; no CI dispatch/push or new backend without owner approval. Never set CI locally to evade guards. Report SQL tests as unexecuted until real isolated SQL/RLS/race execution.
- [ ] Save evidence/report/steward proposal outside vault; read back saved content. Verify local commits/status and UTF-8 Desktop/clipboard handoff.

## Review focus

Initial setup and uncertain-create reconciliation; exact retry after lost response; end/cancel after disable; excluded outcomes still count as stored records; disabled device history and receipts; duplicate evidence versus later completion; simultaneous streams across tabs/sessions/Tenants; release while renewal is in flight; fail-closed expired renewal and crash recovery.

## Evidence limits

SQL acceptance is a separate pending gate. Mocked RPCs and source review do not prove RLS/concurrency. Existing CI/audits are historical. No money-saved/spending-cap claim; Daily hard-stop limitation remains separate. No Docker, production/Studio mutation, paid resources, pilot expansion, notifications, real calls, computer control, push, merge or deployment.

## Source and local verification checkpoint

All six source repairs and focused SQL regressions are prepared in separate logical local commits. The unchecked execution steps above remain an acceptance checklist, not missing source work. The guarded harness now includes transactional baseline SQL reproductions for all six findings and physical-session races for the last actor/account history slot, retained-device slot, same-session tab, profile slot across sessions, disconnect/renewal, and refusal before a held account lock. Optional real transport acceptance tests three tabs, fourth-tab 429, renewal and release through the compiled app and isolated Realtime backend. These SQL/transport paths have not run.

Values: new history 30/profile/day, 300/profile/rolling 30 days, 120/account/day and 1,200/account/rolling 30 days; retained devices 20/profile including disabled/expired (10 active unchanged); streams 3/session and 6/profile, 90-second lease, 30-second renewal and 240-second maximum lifetime. History limits provide headroom above 6 admitted calls/day while bounding refused-record ingress. Retained devices allow one active allowance plus rotation headroom without deleting receipts. Stream values support three tabs on each of two sessions. Existing excess history/devices are not purged.

Fresh local evidence: 146 tests/27 files pass with one worker and 768 MiB heap; media RED had three failures before correction; lease contract/lifecycle RED had eleven failures before correction, then fourteen route tests pass. TypeScript passes at 1,024 MiB; scoped ESLint passes; zero tracked secret findings/2,315 files; both harnesses pass node syntax checks; one transport acceptance-helper unit test passes. Full build held below the existing 5.5 GiB available-RAM guard. No new dependency or grant to private tables.

Independent read-only review found/fixed fixture counter upsert and SQL NULL parsing errors; exact dollar delimiters and final diff were reread. Successful matching replays are throttled before shared work. Failed RPC transactions still roll back limiter charges; no universal durable request-limiter claim. Already exhausted fresh history gets a cheap authorized preflight plus an authoritative under-lock recheck.

Actions usage API returned 404; remaining allowance is unverified. No CI dispatch or push occurred. Concrete exact-commit validation and proposed canonical-memory/Security content are outside the vault in the output directory. Isolated SQL/RLS/races and compiled-app transport remain pending approval/allowance verification; browser/media QA remains with the owner.
