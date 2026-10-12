# Coupons feature acceptance handoff

2026-10-12. Agent: Codex. Status: PASS for isolated Coupons feature acceptance. Database/application checks, financial verification, browser widths and independent source reviews pass.

## Checkpoint and isolation

- Worktree: `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-White-Label-Coupons-Impl`.
- Branch: `feat/white-label-coupons-enforcement-20261011`; accepted parent baseline `adad483cb23e3fc8c98c399ee2034f8b45ad1017`. The final report and ignored acceptance receipt record the resulting feature commit.
- Exact reserved migration: `20261011172233_coupons_module_enforcement.sql`. Exact reserved suite: `137_coupons_module_enforcement.test.sql`.
- Current guarded project: `Wolf-Forge-Coupons-Impl-20261011`; PostgreSQL identifier `7695710951405838374`; container/volume `supabase_db_Wolf-Forge-Coupons-Impl-20261011`; network `supabase_network_Wolf-Forge-Coupons-Impl-20261011`; API 56321, DB 56322, app 3012.
- The integration owner reconciled the identity record after the earlier fresh replay. This final-acceptance resume performed no reset, recreation or migration reapplication. All 151 versions are registered, with the reserved version latest. Current installed definitions match source.
- Canonical, Forms, Builder QA and integration databases were excluded from execution. No other worktree or branch was modified. Both independent reviewers were completed/idle and no Coupons app/test process remained active before this resume.
- `supabase/config.toml` retains its assigned machine-local configuration, excluded from the feature commit. Private credentials and operational evidence remain ignored. Synthetic browser passwords were restored; the local app was stopped after QA. Synthetic QA records remain in the isolated database. Do not delete financial history or reset this database as routine cleanup.

Global OS/Active Worktree Protection and Skills Index were read from `C:/Users/TrojanNiAnton/Downloads/Anthony OS-20261009T175758Z-1-001/Anthony OS/10 Templates/Coding Agent OS/`. Canonical project memory is the same vault's `02 Projects/Wolf Forge Platform/AI Memory`, with sibling Security notes. All remain read-only. The original lifecycle audit and orchestration report guided implementation; the audit was not repeated. Earlier blocked handoffs and evidence are preserved under `coverage/coupons-qa/pre-*`.

## Accepted behavior

1. Issued Invoice discounts and saved Subscription economics remain preserved when Coupons is OFF. Ordinary no-Coupon purchases and independently authorized existing Invoice settlement still work. Existing Invoice-OFF gates remain authoritative.
2. Published Coupons policy participates in permissions, Coupon RPCs, validation/quotes/calculation, restrictive RLS and trusted writes. Root/rule/link mutations and new redemptions refuse OFF. Tenant-first serialization, fresh post-wait authorization and higher-isolation refusal preserve the existing concurrency protocol.
3. Store/wallet new-Coupon checks run after authorized exact financial replay and before quotas/effects. A Coupon becoming unavailable produces an explicit error; it cannot silently turn a quoted purchase into a full-price charge.
4. Subscription construction derives provenance from the current same-parent plan. An exact historical Coupon ID, cents and stored duration may carry forward, including the existing null-ID browser payload, only with preserved Service, quantity, currency, taxable state and applicable version/date. Changed economics refuse OFF. Trusted plan/item guards prevent omitted, staged extra or rewound benefits.
5. Cycle identity preserves Subscription, plan, sequence and dates, prevents deletion/reset/backdating, and requires the accepted applicable plan. Forward period gaps remain supported. Existing sequence-based first-payment behavior remains: voiding an unpaid first cycle does not discount sequence two; issuance adds no redemption.
6. Coupon activity/raw tables and notifications require current availability and actual-parent access, including legacy `coupon` and `coupons` categories. Independently authorized financial history remains visible. Trusted truncation cannot erase Coupon/redemption/cycle evidence.
7. The Coupon access boundary rechecks on mount, focus, visibility and 15-second polling, then removes controls on authoritative denial. Transport failure alone does not revoke access. Subscription guidance explains exact terms preservation. Database errors and Builder guidance reflect the approved policy.
Locking decisions follow [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) and the existing Tenant lifecycle protocol.

8. The confirmed 320px layout defect is fixed by removing only the global body's 320px minimum width. Normal block sizing now accommodates classic scrollbars without clipping content or adding overflow masking. [CSS minimum-width behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/min-width) explains why the removed floor overrode the available width.

Meaningful files: reserved migration and suite 137; policy expectation updates to SQL suites 129/130/131/132/133/135; Coupon layout/action/access boundary; Subscription form guidance; database error mapper; White Label preview and related Vitest tests; one global CSS declaration removal. Existing accepted migrations were not edited.

## Final verification evidence

Evidence is worktree-local in ignored `coverage/coupons-qa/`. These operational scripts/logs are not a second memory tree or a portable committed test package. Historical failed attempts remain distinguishable from acceptance logs.

| Gate | Verified result | Evidence |
|---|---|---|
| Final clean full pgTAP | 125 files / 5,822 assertions PASS; explicit process exit 0 | `full-db-final-clean.log` |
| Focused suite 137 | 63 assertions PASS on current installed migration | `focused-baseline.log`, mutation harness baseline |
| Full Vitest after CSS correction | 233 files / 3,025 tests PASS; exit 0 | `vitest-acceptance.log` |
| Installed definitions and privileges | 24 source bodies match; 56 baseline signature ACL/configuration/security-definer contracts preserved; 151 registered migrations | `readback-final.log`, `readback.json` |
| Scoped SQL lint | public/private PASS, exit 0 | `sql-lint-acceptance.log` |
| Independent-session races | 11 actual overlapping two-session scenarios PASS; plus higher-isolation refusal | `races.json`, `races-more.json`, associated logs |
| Serial defensive mutation/restoration | Five mutants detected; exact body/ACL/configuration/trigger/policy fingerprint restored after every rollback, repeated on reconciled identity | `mutants-acceptance.log`, `mutants.json` |
| Type generation, TypeScript, zero-warning lint, production build | PASS, explicit exit 0 for each | `typegen-acceptance.log`, `typecheck-acceptance.log`, `lint-acceptance.log`, `build-acceptance.log` |
| Secrets and Git diff | Zero findings across 1,660 tracked/staged files; diff checks pass; machine config/credentials excluded | `secrets-final.log`, final staged diff checks |
| Dependency audit | No high/critical finding; existing moderate music-metadata issue remains KI-155 | `dependency-audit.log` |

The full SQL run preceded committed browser fixtures, because some pre-existing suites assume an empty customer/catalog state. An earlier populated-fixture full run failed those assumptions; it is not counted as acceptance. No SQL implementation changed after the clean final run. Application-only CSS correction received fresh full Vitest/build checks.

Race scenarios: Coupon root/publication both orders; rule/publication both orders; Store/publication both orders; wallet/publication both orders; authority revoked while waiting; two Company members competing for a single-use redemption; identical same-ID concurrent purchase. All eleven observed real blocked waiters before release. Losing transactions preserved money and row counts; exact replay returned the same receipt without another debit.

## Financial and browser proof

Focused SQL covers 1,000-cent subtotal, 100-cent discount and 900-cent settlement; zero-effect OFF denial hashes; exact Store/wallet/terms replay; ordinary no-Coupon purchase; saved duration after live Coupon changes/archive; changed snapshot refusal; staged/omitted/rewound benefits; sequence and date identity; no extra redemption; trusted mutations; owner/staff/PA-only/anonymous authority; RLS and notification denial. Existing boundary suites retain foreign Company/Tenant coverage.

Final authenticated browser verification used normal synthetic owner/client logins. Earlier staff and Platform Admin normal-login checks remain recorded; PA-only authority is separately exercised in SQL (the browser PA also had staff membership). Quick Access remained OFF.

The owner submitted unchanged terms with Coupons OFF. A before/after database comparison proved the original Invoice and original plan unchanged, and version 2 preserved Coupon ID, forever duration, quantity 1, unit amount 1,000 cents and discount 100 cents. Two further exact accepted purchase replays returned the same 900-cent receipt while wallet, transaction rows and redemption rows remained byte-for-byte unchanged. Evidence: `ui-financial-before-acceptance.json`, `ui-financial-after-acceptance.json`, `ui-financial-acceptance.log`. The client Invoice displayed its saved $1 discount, $9 paid total and zero balance. A fresh owner Coupon request returned 403 OFF. Earlier live-OFF polling verified controls unmount into an accessible denial alert.

Seven exact CSS viewport widths were checked after the layout correction: **320, 360, 390, 430, 768, 1280, 1440**. Invoice, Coupon editor, open Coupon filter and Subscription editor all had document scrollWidth <= clientWidth. At 320, baseline clientWidth was 303 and scrollWidth 320; afterward both were 303. Coupon Service choices and long saved-Service content fit. The Coupon filter and Subscription interval control opened with Enter, closed with Escape and returned focus to their triggers. Sticky actions remained reachable. Temporary viewport override was reset.

Reduced-motion coverage is source verification: existing Coupon archive, Subscription, AnimatedSelect and MobileFilterSheet rules disable their animation/transition; the new boundary has no motion. The connected browser provider exposes viewport control but no reduced-motion emulation, so no emulated-preference runtime pass is claimed. This is a verification-method limit, not a new motion regression. The unchanged portal navigation drawer responds to its explicit keyboard toggle but did not close when Escape was pressed on a navigation link; retain as a separate nonblocking baseline keyboard issue. Browser extensions produced development hydration warnings. Localhost separated Coupons QA cookies from other stacks using 127.0.0.1.

## Independent reviews

- Financial reviewer: PASS, no remaining financial blocker. Findings about snapshot omission/rewind, staged extra benefits, legacy categories, sequence/date resets and backdating were corrected and tested. Forward gaps and the sequence-based first-payment rule remain intact.
- Security/application/accessibility reviewer: PASS, no remaining Coupon blocker/high. Trusted TRUNCATE and Coupon-history cycle bypass findings were corrected. Helpers remain private/revoked with empty search paths; financial replay order and existing ACL contracts are preserved. Final one-declaration CSS correction passed independent source review and primary browser verification. Baseline portal drawer Escape behavior is nonblocking and disclosed above.

Reviewers performed independent read-only source review. All runtime evidence was executed by the primary writer; do not describe it as independent reviewer execution.

## Integration handoff and retained limits

- Forms must integrate first. This isolated validator retains baseline mandatory Forms while making Coupons optional. Compose both policies and all earlier module dependencies; whole-body last-writer replacement would discard accepted safeguards. Reconcile permission engine, notification parent predicates, Subscription insertion and Store/wallet functions with the integration branch. The local `readback.json` records all replacement full signatures, predecessor body hashes/ACL/configuration and current source hashes against the coordinator's 56-signature inventory. Final catalog checks also deny execution of all nine new private helpers to anon/authenticated/service_role (27 assertions), with Coupon triggers enabled; see `authorization-final.json`.
- Combined integration must rerun all tests, source/installed contracts, grants, policies, triggers and combined toggle/replay races. Isolated acceptance does not establish combined acceptance. Services composition remains integration-owner work.
- KI-153 remains open: pending completion/reconciliation, successful-refund headroom reservation, and ledger-versus-returned-money limitations. No refund/payment system or repricing of agreements was introduced. Preserve KI-154 extension lint, KI-155 dependency issue, KI-156 older generated-type drift and Coupon namespace KI-116/D-277.
- Content already delivered before OFF cannot be recalled from offline/browser caches. Live management rechecks; a stale generic navigation link can persist until fresh shell navigation while the server denies access.
- The earlier setup-probe export remains in ignored evidence; it was not required by the reconciled guard and was not restored. No reset or registered migration reapplication is authorized for follow-up acceptance.

No shared Second Brain edits, merge, rebase, cherry-pick, push, hosted writes or Production deployment. Stop after the focused local feature commit and report its SHA. The integration owner is the only future shared-memory writer.
