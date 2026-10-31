# Invoice manual payment and sharing

Confirmed with the user: manual payment covers the full outstanding invoice balance; a receipt screenshot is required and the client's transaction reference is optional. A successful authorized review creates service orders and required intake forms. Public links show the invoice/payment instructions; receipt reporting requires a signed-in authorized client.

## Workflow

Team-configured manual PayPal URL and payment instructions live under Billing & Payments, separate from API-provider connection state. They start disabled/unconfigured. The client pays outside WOAD, uploads one private image receipt, selects the method, optionally enters the reference, then reports payment. A separate pending claim is visible to the client and to authorized invoice reviewers. It does not credit a wallet, change financial totals or mark the invoice paid.

The existing invoices.mark_paid capability controls review. Reviewers verify actual receipt of money, enter payment date/reference and approve or reject with a reason. Approval locks/revalidates the invoice and claim, records one succeeded payment using the existing ledger boundary, links the approval and provisions each unlinked service line once. Existing linked orders are reused; non-service lines create no orders. Client identity comes from the invoice/claim, never by impersonating the purchaser. Order start remains blocked until the frozen required intake forms are submitted. No historical paid invoices are backfilled.

Manual collection uses the actual full outstanding balance; a hypothetical wallet split does not reduce it. Concurrent wallet settlement or another review cannot create a duplicate/overpayment ledger entry. A stale balance/state requires reconciliation rather than silently changing the reported amount. Reviewer reconciliation references are deduplicated for new approved manual claims.

## Sharing and Actions

Share offers the existing authenticated invoice link, an authenticated direct-payment link, and explicitly created public invoice links. Public links are random, hashed in storage, expire after 30 days and can be revoked. A newly created public link is shown for copying; existing links can be revoked/replaced without exposing stored raw tokens. A limited projection shows invoice items/totals/dates and payment instructions, never contacts, receipts, wallet, internal history or customer workspace access. Receipt submission always requires client sign-in and current invoice/company access.

Reuse existing invoice dialogs, action menus, clipboard controls and email composer. Email invoice prepares invoice/payment links for the authorized team user to review and send through their existing Gmail connection. Implementation/testing sends no real emails or payments. Existing financial actions remain capability-gated.

## Boundaries and validation

Receipt uploads are private authenticated invoice-owned PNG/JPEG/WebP images, maximum 4 MiB. Enforce size/type/content validation, reservation ownership, bounded upload/claim counts, no overwrite and authorized no-store/nosniff downloads. Public share reads cannot upload, approve, refund, charge or access raw tables. A screenshot is evidence for human review, never proof of settlement.

Test with synthetic accounts/data and disposable local/CI infrastructure. Do not open Docker on the PC, alter RojanCRM, send real invoice emails, make purchases/payments, mutate customer invoices or broaden role defaults. Canonical notes stay read-only under D-319; final evidence includes a steward proposal. Keep the dirty skeleton worktree unchanged.
