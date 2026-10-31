# Manual invoice payment and sharing candidate

Started from main `90f881c8ef3c388189edc3b27b961aab3ca6ea04`; incorporates upstream PR92 at `e6edf25b0af5dc00c4cd7445f446964b2d636331`. Branch: `codex/woad-invoice-manual-payments-20261031`, draft PR99. This candidate is not deployed.

## Behavior

Billing & Payments lets an authorized invoice manager configure manual instructions and an optional HTTPS PayPal payment link. Settings start disabled and empty. This is an external manual payment workflow, not a new PayPal processor connection or automatic charge.

An authorized client pays the full outstanding invoice balance outside WOAD, uploads a required private PNG/JPEG/WebP receipt (4 MiB maximum), optionally supplies a transaction reference, and reports payment. The submitted expected balance detects a stale screen; the actual claim amount is derived in PostgreSQL. Reporting leaves the wallet and payment ledger unchanged. One pending report per invoice is allowed.

An authorized `invoices.mark_paid` reviewer sees a pending report and receipt, verifies actual receipt of money in their external account, and enters the actual paid date and reconciliation reference. Approval records one successful payment and provisions each unlinked service invoice line once, including frozen required intake forms. Existing linked orders are reused, custom lines create none, and quantity does not silently multiply orders. Start order still requires the frozen forms. Rejection requires an explanation. Review history and existing financial history are preserved.

Share offers `/view/invoices/{id}` for the authenticated invoice, `/pay/invoices/{id}` for payment options, and explicitly created public invoice links. Both authenticated entry links retain the exact invoice destination through login. Public links expire after 30 days and can be revoked. Only a hash is stored; copy the raw URL when creating it. The public projection includes commercial invoice items/totals/dates and enabled payment instructions, with no contacts, address, receipt, wallet or internal history. Receipt submission requires a currently authorized client session.

Email invoice opens the existing Gmail composer with private invoice/payment links. Nothing is sent automatically. Existing Edit, Issue, Record Payment, Refund and Void authority remains; the UI directs pending manual claims through review. Print uses the existing browser PDF path.

## Security and limits

- Reservation/authorization and rate limits precede upload buffering; actual bytes, checksum, type and size are verified. Upload retry never overwrites a different object. Recheck current authority after Storage before verifying or releasing downloaded bytes.
- Private receipt bucket has no direct anonymous/authenticated read/write policy. A narrow trusted server operation verifies a client-owned reservation; review/configuration are never delegated client-support operations.
- Maximum 10 receipt reservations and 5 claim attempts per invoice; bounded upload/download counters. Max 3 active public links and 20 new links per invoice/day. Public reads have per-link and Tenant budgets.
- Approval rechecks current permission after waits, locks the invoice/claim, compares actual balance/currency and deduplicates new reconciled references. No impersonation, caller GUC or general project-create bypass is added.
- Public pages use no-referrer, no-store and noindex headers; app/Sentry error, span and breadcrumb paths are scrubbed. Infrastructure access logs and already copied links remain outside application redaction.
- A screenshot is evidence for human reconciliation, not proof of payment. A human can still misidentify an external transfer; no provider verification is claimed.

## Migration order

1. `20261031122204_invoice_manual_payment_claims.sql`: separate settings, reservations, claims/reviews, private Storage, safe delegated client operations and cost limits.
2. `20261031122205_paid_invoice_order_fulfillment.sql`: exact invoice-derived order provenance, fulfillment and frozen-intake/start integration. Guarded current-source patches preserve the October 30 fail-closed projection and existing owners/ACLs.
3. `20261031122206_invoice_public_share_links.sql`: hashed, bounded, expiring/revocable read capabilities and limited public projection.

These files were created with the installed Supabase migration command. None is applied to hosted Studio or production. Never deploy app code before the reviewed migrations. Do not backfill historical paid invoices.

## Validation evidence

Local output directory: `outputs/invoice-manual-payments-20261031` outside the checkout.

- Focused final application tests: 107 passed in 11 files. Scoped lint and diff checks passed.
- Full bounded local run: 4,005 passed; one old assertion expected exactly one security-header rule. It was updated to retain all global headers plus the stricter invoice-only override, and its focused rerun passed. This run predates final source edits; exact-head full acceptance is delegated to CI.
- Actual-component Chromium fixture: 208 checks across 320/360/390/430/768/1280/1440 px, including long text, short viewport, open menus/dialogs, keyboard/focus, upload/report/review/settings/share/email and four public invoice states. Stable source hashes and screenshots are in `visual/evidence.json`. Actions/data/receipt API are synthetic; unoptimized Next Image uses an equivalent native image adapter. This does not prove Auth, Storage, RLS, provider settlement or real-device behavior.
- Final application candidate `14c33d09` passed CI TypeScript, full production build/PDF font trace, lint, production dependency audit and 4,195 application tests in 334 files.
- Fresh disposable Supabase passed 6,796 assertions in 150 SQL/RLS files, plus real PostgREST/Auth/private-Storage/delegated-client/current-access/concurrency checks. This includes SQL183/184/185 and exact-once manual settlement/order/intake behavior.
- The actual authenticated purchase/intake/signature/start/PDF workflow passed all 59 service cases / 37 templates, with 57 drawn signatures, 38 uploads and 59 text-checked PDFs. Seven builder widths passed. Real-device media, interactive login/BotID UI and external money reconciliation remain separate acceptance.

PC RAM remains below the existing 5.5 GiB full-build guard. No local full build or Docker was launched. RojanCRM, William, clients and production are excluded from synthetic validation.

## Release gate and manual acceptance

The owner initially left the single synthetic history-scanner alert unresolved, then explicitly approved reviewing that exact finding and continuing the WOAD rollout on 2026-10-31. Only the pinned commit0679fe73/file/rule/line fingerprint is added to `.gitleaksignore`; scanning remains active. The owner approved the simulated local UI review separately; this is not full manual database acceptance. Production release is authorized, subject to fresh green CI, verified backup, migration prerequisites and promotion checks below. These release checks remain pending until their authoritative readbacks succeed.

Before rollout: exact-head typecheck/build/unit/lint/dependency/history-secret checks, all pgTAP tests, real manual-payment REST/Storage/race checks, and the 59-service workflow must pass. Review the three migrations and prepare a fresh verified encrypted production backup plus exact ledger/function/data fingerprints. Apply only those migrations with bounded locks/timeouts, verify their source/ACL/provenance invariants and unchanged business data, then separately promote the exact tested app. Keep manual settings disabled until the owner privately configures the real payment destination.

Manual QA must use a designated test invoice/client and synthetic receipt, never a real payment or customer invoice: report pending without credit, review reject/resubmit, approve exactly once, see Orders/intake, complete required forms before start; copy/revoke/expire public links; sign-in return; compose email without sending. Real payment reconciliation and actual-device acceptance remain human checks.

## Memory steward proposal (no reserved IDs)

Canonical notes and Security remain read-only under D-319. On accepted merge/release, the single steward should record the manual-payment boundaries, synthetic validation and actual remaining acceptance in existing Current State/Implementation Log/Decisions/Architecture and Security10/11/14/16/17. Preserve the distinction between a client claim, verified ledger settlement, and external money receipt. Record the final PR, tested SHA and deployment only after authoritative verification.
