# Client workspace access repair

The live Owner/Admin client view displayed the support banner and Onboarding count, but Onboarding itself returned “Form information is unavailable under your current access.” `loadFormsVisibility("client")` always lists submission summaries; `app_list_form_submissions` was absent from both reviewed support operation lists. The application refused this dependency before sending it to PostgREST.

The repair adds that one existing client-scoped RPC to the TypeScript list and a new migration replacing the private database operation-list helper. Its existing SQL still checks module access, current Tenant, exact client and company, and redacts inaccessible Order/Ticket pointers. Existing function ownership and ACLs remain intact. No wildcard, role grant, authentication exchange or customer backfill is introduced.

An adjacent conversation-presence bug detached `SupabaseClient.rpc`, losing its receiver and silently swallowing the resulting exception. The action now calls the client method directly. The regression uses the actual SDK and fails on the old action for both ordinary and delegated clients.

## Scope and checks

- One-click support login retains the administrator's original authenticated session; no client's login credentials are required. Banner, audit attribution, bounded capability and Exit remain.
- The actual Forms visibility action runs through the real service, repository, SDK and restricted fetch in a regression test. Database refusal must still close the page.
- Isolated pgTAP and the existing CI-only real PostgREST harness exercise selected-client visibility, another client in the same company, another company, another Tenant, access revocation and a missing request hook.
- Existing read/write paths for Projects, Inbox, Reports, Store, invoices, wallet, subscriptions, calendar, search, intake drafts/uploads/submission and PDF access were audited for operation-list omissions. No other omission was identified by that source audit; it is not browser acceptance of every workflow.
- Focused local tests and lint precede a full remote CI build/typecheck/test/database/security run. No local Docker or development server is needed.

## Release boundary

Before production: review the complete diff and remote checks, capture the current helper definition/owner/ACL and migration ledger, and compare the deployed helper to the expected prior definition. Apply only `20261029072700_client_support_form_submission_reads.sql` with bounded lock/statement timeouts. Verify the resulting definition and unchanged grants/data before promoting the matching application build. Keep the prior application deployment and captured helper definition for recovery. No real customer transaction or message is required for technical acceptance.

WordPress credential collection is a separate follow-up from this access repair. The current disabled `secret` control has no encrypted form-credential storage implementation. Replacing its notice requires that storage/read boundary, not conversion into an ordinary public text response. No credential fields or customer passwords are changed by this patch.
