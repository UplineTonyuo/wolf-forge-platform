# Client reply status, Services naming and invoice dialog

Base: `ef677f63468910aec7f411391802901d4bfdad15`. Branch: `codex/woad-client-replies-invoice-20261031`.

## Result

- Invoice Issue/Payment/Refund/Void dialogs use `margin: auto`. Tailwind's margin reset had overridden native dialog centering. No financial action, amount, permission or submission logic changed.
- Client Orders shows **Unanswered** beside an order title when the latest eligible public human message is from the team. A later public company-client reply clears it; merely reading does not. Working/Pending and other operational statuses stay independent.
- Client navigation, service panel and catalog copy use **Services** instead of Investments. Existing routes and module/permission identifiers remain unchanged.

## Database and access

One additive migration: `supabase/migrations/20261031113524_client_order_response_states.sql`.

`app_list_my_order_response_states(uuid[])` returns authorized current-company/current-Tenant order IDs and nullable flags only. It requires active client context, portal Projects, Projects view and Tickets view; validates the raw batch before deduplication; and excludes archived orders. Linked Ticket authority takes precedence over native history. Inaccessible or mismatched linked history returns unknown, never a native-history fallback. Systems, guests, internal notes and unsent messages cannot create or clear the flag. Timestamp and message ID define deterministic order.

The migration adds exactly this read operation to the existing client-support allowlist, preserving other function source, owner and ACL. It does not change internal Unanswered metadata, role defaults, conversation writes or existing answers. Normal Owner sessions cannot call the client RPC as clients; delegated support must pass its existing live session/hook checks.

Only the Orders page requests metadata for already authorized order IDs. Failure or unknown metadata leaves Orders and intake usable with a retry notice. Sidebar/dashboard requests do not gain message queries.

## Verification at preparation

- 100 focused tests across seven files passed; scoped ESLint and REST-smoke syntax check passed.
- Native PostgreSQL: one pre-migration failure and 48 post-migration checks passed using the exact migration plus actual context/access helpers and synthetic schema/auth prerequisites. This is not full Supabase/RLS acceptance.
- Invoice component browser fixture: 56/56 before-fix cases reproduced the top-left defect; 56/56 after-fix cases centered and fit at 320/360/390/430/768/1280/1440px and two heights. Native keyboard containment, Escape/Cancel/focus return and reduced motion passed. No invoice action submitted.
- Orders component browser fixture: all seven widths passed wrapping/overflow, true-only badges, five-row pagination, filters, keyboard navigation, intake links and metadata-error fallback. Actual Services registry route/module checks passed.

Evidence directory outside Git: `outputs/client-replies-invoice-20261031/`, including `focused-final.log`, `client-response-native-result.json`, `invoice-visual/red-green-comparison.json` and `projects-visual/evidence.json`. Browser fixtures are synthetic component checks, not authenticated end-to-end acceptance.

The PC was below the existing 5.5 GiB full-build RAM guard. Full typecheck, compiled build, full unit suite, fresh Supabase pgTAP/RLS, real delegated PostgREST checks and security scans must pass in CI before rollout. SQL182 and the extended REST smoke cover the new metadata and support path with synthetic users only. CI's disposable local Supabase runs on its runner; Docker stays unopened on the user's PC.

## Rollout and manual acceptance

Before any approved production rollout: verify current main/base, green checks and exact candidate; take and verify a fresh read-only production backup; record existing schema/business fingerprints; apply only this migration and verify preservation; deploy the exact reviewed SHA and switch WOAD only after readiness. Do not issue/refund/void real invoices or message real clients to test.

Manual QA using test accounts: open Issue invoice and Cancel, check centered layout/focus on desktop and phone; confirm Services still opens the catalog; send a public staff test message, observe the client's Unanswered label, open/read without replying and confirm it remains, then send a client reply and confirm it clears on refreshed Orders. Confirm a private note/system event cannot change the badge and Working status remains Working. Include Owner/Admin delegated client view. A refresh/navigation is required; this change adds no polling or live list subscription.

## Memory steward proposal

Canonical notes remain read-only under D-319. After verified rollout, the steward should narrowly update Current State and append the exact candidate, CI/evidence receipts, one migration, nullable client-only metadata semantics and invoice centering fix to Implementation Log. Record the reviewed client RPC/delegation scope in the existing Security authorization topic. Do not record this preparation as a production pass.
