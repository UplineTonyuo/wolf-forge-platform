# WL-2.34 published module enforcement: Phase 1

Base: 4215269. Local only; no saved draft publication or effective policy seeded.

## Canonical architecture audit

public.permission_modules defines account-class/navigation entries. private.white_label_modules is the nine-module subset. Projects, Subscriptions, Coupons and Investment Intent require Services. Existing membership/preset/override resolution is retained.

| Module | Navigation / page / action / API | RPC / existing guards | Unauthenticated / system dependencies | Data ownership / disablement implications |
| --- | --- | --- | --- | --- |
| Services | /services/**, /account/store/**, service/purchase actions | service and purchase RPCs; Services/Store and operational permissions, RLS | Guest/public purchase audit pending; money movement and Project fulfillment | Tenant service/folder, company purchase; dependency for four modules |
| Projects | /orders/**, /account/projects/**, actions, attachment API | order/task/conversation RPCs, operational access helpers | Guest paths audit pending; purchase fulfillment, legacy Ticket conversations | Tenant order/task/messages; requires Services |
| Tickets | /tickets/**, /account/tickets/**, actions, attachment API | Ticket helpers + module/capability guards | Public Contact Form generated Tickets; legacy conversations | Tenant ticket/message; public support policy needed |
| Reporting | /reporting, /reporting/new, /reporting/[reportId], /account/reporting and detail, reporting actions, quick action | Fourteen business RPCs below, editable-report helper, Reporting permissions, direct SELECT RLS | No anonymous/service-role RPC grants; notifications + report-only deliverable ledger; no financial or job consumer | Tenant report/sections/entries, company scope, profile receipts; preserve all historical records |
| Invoices | /invoices/**, /account/invoices/**, actions/payment endpoints | invoice capability/read helpers and RLS | Settlement, webhooks, public guest payments require explicit policy | Tenant invoice/company wallet/payments; financial obligations |
| Subscriptions | /subscriptions/**, /account/subscriptions/**, actions | subscription capability/read helpers and RLS | Renewal/reconciliation, scheduled invoices | Tenant subscription/company/service; requires Services |
| Coupons | /coupons/**, checkout and coupon actions | coupon tenant/permission checks; purchase and invoice callers | Guest redemption audit pending; alters prices | Tenant coupon/redemption; requires Services |
| Investment Intent | /investment-intent, portal Store interest action | service-interest RPCs, operational guards | Internal notification fanout; guest behavior audit pending | Tenant service interest/company; requires Services |
| Forms | /forms/**, /account/forms/**, /f/[canonicalKey], actions | form capability, assigned/public submission checks | Onboarding, Contact Form Tickets, suspended Tenant rejection | Tenant form/version/submission/assignment |

Operations (todo, /todo/**, /api/operations/**) is outside the configurable catalog and retains the Wolf Forge-only gate.

Eight non-pilot modules are not complete audited enforcement slices. Both published-row validation and the trusted writer reject omission of any of them. No money, webhook, reconciliation, scheduled-job, Contact Form or public guest behavior changes.

## Reporting coverage

Business RPCs: app_send_client_report, app_list_my_client_reports, app_get_my_client_report, app_mark_client_report_read, app_count_my_unread_reports, app_create_report_draft, app_save_report_draft, app_send_report_draft, app_discard_report_draft, app_list_internal_reports, app_get_internal_report, app_get_report_send_status, app_list_reporting_service_options, app_list_reported_one_time_deliverables.

The two report-send-anytime grant/revoke RPCs manage existing permissions, not report data; they cannot override disabled policy. ReportingRepository uses user-scoped RPCs only. All five pages already require the correct account-class module. Legacy send checks reports.send without a module call. Central profile_has_permission_in_tenant narrowing closes it, report direct RLS, unread count, notification readers and explicit-Tenant notification fanout. Receipt RLS and historical activity's admin shortcut need additional predicates. The recipient action and Send Reporting quick link need module checks. Notifications have no API table grants. No Reporting API route or background production caller was found.

## Published authority

Append-only private.tenant_module_publications stores Tenant, explicit revision, canonical module set, server-stamped auth.uid Platform Admin actor/time, and reason. Primary key, Tenant/profile FKs, immutable history trigger and Tenant row lock enforce ordered revisions and concurrency. No API role has table/function access, including service_role. Postgres-only private.publish_tenant_modules requires the existing Platform Admin entitlement and explicit expected revision; it never reads/copies drafts. No operational Publish button/API.

Active Tenant with no row retains existing authorized behavior. Invalid/unknown published state denies; no draft or other Tenant fallback. Effective permission is published predicate AND the existing preset/override/account-class permissions. Only Reporting can be disabled in Phase 1.

## White Label 404 QA issue

Read-only diagnosis: port 3000 serves Wolf-Forge-Loading-Skeletons-20261007, which has neither the White Label source route nor an entry in its dev manifest. No server for this checkout was initially running. This explains the current port 3000 404; the historical manual URL is uncorrelated. Normal login alone does not establish Platform Admin entitlement, non-Quick-Access identity or development/opt-in/loopback gate eligibility. Browser PASS requires real entitled login on this checkout with all gates preserved.

## Verification

Pending. No claim of completion until focused/full pgTAP, mutation checks, app checks, real route/browser coverage and three independent final reviews.
