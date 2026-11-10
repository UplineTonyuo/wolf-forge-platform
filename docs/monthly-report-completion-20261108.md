# Monthly report completion

## Behavior

- Completing supported monthly SEO/GMB work requires a nonarchived published (`sent`, with `sent_at`) report for the exact Tenant, client, Service and explicitly selected reporting month. The order's start date and the report's publication month do not choose the work month. Historical completed orders are preserved.
- When evidence is missing, the team sees the **Monthly report required** sheet. They choose the work month and can open the existing report builder with that exact client/Service/month prefilled. Saving a draft does not complete the order; publishing matching evidence allows completion on retry.
- New Report offers supported Services owned through an eligible subscription, current working/waiting order, or paid/provisioned purchase. Ownership and report scope are rechecked server-side; names alone never qualify.
- An Owner, Admin or Manager with current Project completion authority can override the requirement with a trimmed, nonblank reason of at most 1,000 characters. The atomic operation records immutable private evidence for the exact order/Service/month and completes the order. Exact retries preserve completion time and audit; conflicting reasons cannot overwrite evidence.
- The override reason is also recorded in the existing internal-only activity metadata. The internal Order History screen displays the activity summary and timestamp, but does not render metadata. Clients cannot read these activity rows or the private exception table.
- A database trigger enforces the requirement for RPC, direct and multirow completion attempts. Month selection persists without completing work; completion rechecks the locked order's exact scope. Existing tasks, billing and report publication keep their established behavior.

## Migrations

Apply these two migrations in this order, **before deploying the app**:

1. `supabase/migrations/20261108080017_monthly_report_completion_gate.sql` adds ownership checks, the completion trigger, scoped exception evidence/RPC, and retry-stable status completion. Override activity metadata includes the reason.
2. `supabase/migrations/20261108173532_explicit_order_reporting_month.sql` adds the explicitly selected order reporting month and its scoped selection/completion RPCs, with no default or historical backfill.

Both migrations remain unapplied to hosted databases. There is no third migration.

## Release order

1. Pass the standard PR gate, including pgTAP for both migrations, and complete review.
2. Apply both migrations in order before the application deployment.
3. Deploy the app, then have the owner smoke-test month selection, missing-report blocking, matching publication and authorized override. Authenticated browser acceptance is replaced by this owner smoke test after release.

## Rollback

Use Vercel Instant Rollback to restore the prior app. To remove the database completion gate, run:

```sql
drop trigger orders_require_monthly_report on public.orders;
```

Retain the additive schema and existing exception evidence; do not delete reports, selected work months or audit history.
