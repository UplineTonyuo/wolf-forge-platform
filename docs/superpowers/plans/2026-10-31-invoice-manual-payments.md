# Invoice Manual Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Root is the sole tracked-file writer; agents may draft proposals in exclusive output folders and review read-only.

**Goal:** Implement the user-confirmed manual-payment receipt/review/fulfillment flow and invoice sharing/actions.

**Architecture:** Keep client declarations separate from immutable succeeded payments. Use narrow authenticated RPCs and the existing financial authority/ledger boundaries; add explicit invoice-derived paid-service fulfillment rather than calling the wallet Store purchase. Public invoice capabilities receive a limited projection, while receipts and review stay authenticated.

**Tech Stack:** Existing Next.js16/React/TypeScript, CSS Modules/house UI, Supabase/PostgreSQL/Storage, Vitest and pgTAP. No new packages.

**Spec:** docs/superpowers/specs/2026-10-31-invoice-manual-payments.md

## Global Constraints

- Manual full outstanding payment; required receipt screenshot; optional client transaction reference.
- Authorized approval creates service orders and frozen required intake forms exactly once; no client claim marks paid.
- Public invoice/payment instructions, signed-in receipt reporting; expiring/revocable hashed share capabilities.
- No PC Docker, real payments/emails/customer mutations, RojanCRM changes or role-default changes.
- Existing worktree reused on codex/woad-invoice-manual-payments-20261031 from live main90f881c8.
- Canonical notes remain read-only; root alone writes tracked files.

## Review Focus

- Concurrent wallet payment, stale balances and duplicate external references cannot over-credit the invoice.
- A reviewer without project creation rights cannot gain a general project-creation bypass; fulfillment is bounded to authorized paid invoice lines.
- Public links, delegated client sessions, other companies/Tenants and revoked access cannot disclose receipts or financial history.
- Orphan/repeated/forged uploads stay bounded and unusable for approval; raw receipt downloads are private.
- Existing Store purchases, intake start gates and historical paid/signed/secret data remain intact.

### Task1: Database authority and persistence

- [ ] Create migration filename using the installed Supabase CLI help/new command.
- [ ] Add failing synthetic SQL cases for configuration, receipt ownership/quotas, client claim lifecycle, review permissions/replay/concurrency, public projection and exact paid-line order/intake linkage.
- [ ] Implement separate private settings/receipt/claim/review/share records and narrow RPCs; preserve ledger immutability and existing Store authority.
- [ ] Add a trusted idempotent fulfillment helper and explicit frozen-intake/start eligibility for the new paid-invoice origin. Never spoof reviewer/client identity or re-run Store purchase.
- [ ] Run owned portable PostgreSQL checks with synthetic prerequisites where possible; reserve real Supabase/RLS/Storage/JWT acceptance for isolated CI.

### Task2: Application, uploads and UI

- [ ] Add focused failing domain/repository/action tests for the new RPC contract, actual balance, file constraints and denial paths.
- [ ] Add invoice manual-payment domain/repository/service files and compose them through existing server contexts.
- [ ] Implement authenticated bounded receipt upload/download routes using existing validation/storage patterns and explicit client-support read/write allowances only where authorized.
- [ ] Add client report/history, internal review/banner, Billing & Payments configuration, Share dialog, limited public invoice view and direct-payment route. Reuse house menus/dialogs/date/select/clipboard/email components.
- [ ] Preserve current invoice controls and add link-based email composition without sending during QA.

### Task3: Integration and evidence

- [ ] Run focused tests/lint/secrets and real component fixtures at320/360/390/430/768/1280/1440px, including long content, opened menus/dialogs, keyboard, upload/retry/pending/rejected states.
- [ ] Run full typecheck/build/unit/security and isolated Supabase SQL/REST/Storage/intake workflows in CI when PC RAM prevents a safe build. No hosted test-project pausing or migrations for QA.
- [ ] Review current-access checks, replay/races, cross-Tenant/company access, public-token expiry/revocation, upload quotas and unchanged Store behavior.
- [ ] Provide exact candidate, migrations, evidence, remaining manual acceptance and rollout plan. Do not create public links or configure a real payment destination for customer invoices during validation.
