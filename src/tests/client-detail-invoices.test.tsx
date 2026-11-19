/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "../lib/errors/application-error";
import { InvoiceRepository, type ClientInvoiceSummary } from "../repositories/invoice-repository";
import { InvoiceService } from "../services/invoice-service";
import type { UserMutationClient } from "../repositories/types";

const companyId = "10000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  list: vi.fn(), projects: vi.fn(), findInvoiceItem: vi.fn(), listInvoiceOrderIds: vi.fn(), workEnabled: vi.fn(), forms: vi.fn(), candidates: vi.fn(), actions: vi.fn(), boundary: vi.fn(), primaryContact: vi.fn(),
  user: { id: 'actor', tenantId: 'tenant', role: 'staff', clients: { privateManage: false, contactRead: false }, invoices: { view: true, manage: false }, forms: { assign: false }, tickets: { create: false } },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error('not found'); }, unstable_rethrow: vi.fn() }));
vi.mock("../lib/email/client-welcome-email-server", () => ({ canSendClientWelcomeEmail: async () => false }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: async () => ({
  user: mocks.user,
  services: {
    companies: { get: async (id: string) => ({ id, name: 'Synthetic account', created_at: '2026-10-01', status: 'client' }) },
    contacts: { getPrimarySummary: mocks.primaryContact },
    orders: { listForCompany: mocks.projects },
    wfCard: { getMembership: async () => null },
    invoices: {
      listForCompany: mocks.list,
      workEnabled: mocks.workEnabled,
      findItemByOrderId: mocks.findInvoiceItem,
      listOrderIds: mocks.listInvoiceOrderIds,
    },
    forms: { list: mocks.forms, listOnboardingCandidates: mocks.candidates },
  },
}) }));
vi.mock("../components/clients/client-detail-actions", () => ({ ClientDetailActions: (props: unknown) => { mocks.actions(props); return null; } }));
vi.mock("../components/clients/client-detail-sections", () => ({ ClientDetailSections: ({ children }: { children: ReactNode }) => children }));
vi.mock("../components/clients/client-status-control", () => ({ ClientStatusControl: () => null }));
vi.mock("../components/invoices/financial-visibility-boundary", () => ({ FinancialVisibilityBoundary: ({ children, ...props }: { children: ReactNode }) => { mocks.boundary(props); return children; } }));
vi.mock("../components/shell/route-transition", () => ({ RouteTransitionLink: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
const { default: ClientPage } = await import("../app/(internal)/clients/[companyId]/page");

function summary(id: string, origin = 'manual', state = 'paid'): ClientInvoiceSummary & { paidAt: string | null } {
  return { invoice: { id, company_id: companyId, invoice_number: id === 'manual' ? 12 : 13, billing_reason: origin, status: state, created_at: '2026-10-01', issued_at: '2026-10-02', total_cents: 12500, currency: 'USD' }, financials: { presentation_state: state, balance_due_cents: 2500 }, paidAt: state === 'paid' ? '2026-10-08' : null } as ClientInvoiceSummary & { paidAt: string | null };
}
const page = async (tab = 'invoices') => renderToStaticMarkup(await ClientPage({ params: Promise.resolve({ companyId }), searchParams: Promise.resolve({ tab }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.invoices = { view: true, manage: false };
  mocks.user.clients.contactRead = false;
  mocks.user.forms.assign = false;
  mocks.list.mockResolvedValue([summary('manual'), summary('store', 'store_purchase', 'overdue')]);
  mocks.workEnabled.mockResolvedValue(true);
  mocks.projects.mockResolvedValue([]);
  mocks.findInvoiceItem.mockResolvedValue(null);
  mocks.listInvoiceOrderIds.mockResolvedValue([]);
  mocks.forms.mockResolvedValue([]);
  mocks.candidates.mockResolvedValue([]);
  mocks.primaryContact.mockResolvedValue({ name: 'Synthetic contact' });
});

describe('client invoice tab', () => {
  it('loads the exact account, presents manual and store receipts with authoritative balance and detail links', async () => {
    const html = await page();
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(companyId);
    expect(html).toContain('/invoices/manual');
    expect(html).toContain('/invoices/store');
    expect(html).toContain('WF-0012');
    expect(html).toContain('WF-0013');
    expect(html).toContain('Overdue');
    expect(html).toContain('$125.00');
    expect(html).toContain('$25.00');
    expect(html).not.toContain('billing domain is connected');
    expect(mocks.boundary).toHaveBeenCalledWith(expect.objectContaining({ scope: 'internal', companyId }));
  });
  it('shows the verified order reference and title only on the linked invoice', async () => {
    mocks.projects.mockResolvedValue([
      { id: 'linked-order', title: 'Local campaign', order_number: 25, spp_order_reference: 'ABCD5678_2', status: 'working' },
      { id: 'unlinked-order', title: 'Unrelated order', order_number: 26, status: 'working' },
    ]);
    mocks.findInvoiceItem.mockImplementation(async (id: string) =>
      id === 'linked-order' ? { invoice_id: 'manual', order_id: 'linked-order' } : null,
    );

    const document = new DOMParser().parseFromString(await page(), 'text/html');
    const linked = document.querySelector('a[href="/invoices/manual"]')?.closest('li');
    const other = document.querySelector('a[href="/invoices/store"]')?.closest('li');
    expect(linked?.querySelector('a[href="/orders/linked-order"]')?.textContent).toContain('#ABCD5678_2 · Local campaign');
    expect(other?.querySelector('a[href^="/orders/"]')).toBeNull();
    expect(other?.textContent).toContain('Order not linked');
  });

  it('shows the authorized contact above the reference and service, with separate Created and Paid dates', async () => {
    mocks.user.clients.contactRead = true;
    mocks.projects.mockResolvedValue([{ id: 'linked-order', title: 'Custom project title', order_number: 25, spp_order_reference: 'ABCD5678_2', status: 'working', services: { id: 'service', name: 'Local SEO' } }]);
    mocks.findInvoiceItem.mockResolvedValue({ invoice_id: 'manual', order_id: 'linked-order' });

    const document = new DOMParser().parseFromString(await page(), 'text/html');
    const paid = document.querySelector('a[href="/invoices/manual"]')?.closest('li');
    const unpaid = document.querySelector('a[href="/invoices/store"]')?.closest('li');
    expect(paid?.querySelector('a[href="/orders/linked-order"]')?.parentElement?.textContent).toBe('Synthetic contact#ABCD5678_2 · Local SEO');
    expect(paid?.querySelector('time[datetime="2026-10-01"]')?.parentElement?.previousElementSibling?.textContent).toBe('Created');
    expect(paid?.querySelector('time[datetime="2026-10-08"]')?.parentElement?.previousElementSibling?.textContent).toBe('Paid');
    expect(paid?.querySelector('time[datetime="2026-10-02"]')).toBeNull();
    expect(unpaid?.querySelector('time[datetime="2026-10-08"]')).toBeNull();
    expect([...unpaid?.querySelectorAll('dt') ?? []].find((term) => term.textContent === 'Paid')?.nextElementSibling?.textContent).toBe('—');
  });

  it('uses the client record name when contact access is absent', async () => {
    const document = new DOMParser().parseFromString(await page(), 'text/html');
    const invoice = document.querySelector('a[href="/invoices/manual"]')?.closest('li');
    expect(invoice?.textContent).toContain('Synthetic account');
    expect(invoice?.textContent).not.toContain('Synthetic contact');
    expect(mocks.primaryContact).not.toHaveBeenCalled();
  });

  it('starts from invoices when there are fewer invoices than visible orders', async () => {
    mocks.list.mockResolvedValue([summary('manual')]);
    mocks.projects.mockResolvedValue([
      { id: 'local-order', title: 'Local campaign', order_number: 25, status: 'working' },
      { id: 'another-order', title: 'Another local project', order_number: 26, status: 'working' },
    ]);
    mocks.listInvoiceOrderIds.mockResolvedValue(['local-order', 'unavailable-order']);

    const html = await page();
    expect(mocks.listInvoiceOrderIds).toHaveBeenCalledExactlyOnceWith('manual');
    expect(mocks.findInvoiceItem).not.toHaveBeenCalled();
    expect(html).toContain('href="/orders/local-order"');
    expect(html).not.toContain('href="/orders/unavailable-order"');
  });

  it('keeps billing history visible when a related order lookup fails', async () => {
    mocks.projects.mockResolvedValue([{ id: 'linked-order', title: 'Campaign', order_number: 25, status: 'working' }]);
    mocks.findInvoiceItem.mockRejectedValue(new Error('Order lookup unavailable'));

    const html = await page();
    expect(html).toContain('/invoices/manual');
    expect(html).toContain('Order link unavailable');
  });

  it('does not render an order link for an invoice outside the visible history', async () => {
    mocks.projects.mockResolvedValue([{ id: 'unrelated-order', title: 'Campaign', order_number: 25, status: 'working' }]);
    mocks.findInvoiceItem.mockResolvedValue({ invoice_id: 'foreign-invoice', order_id: 'unrelated-order' });

    const html = await page();
    expect(html).not.toContain('href="/orders/unrelated-order"');
    expect(html).toContain('Order not linked');
  });

  it.each(['details', 'projects', 'activities', 'history'])('does not read invoices on %s', async (tab) => {
    await page(tab);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.workEnabled).not.toHaveBeenCalled();
  });
  it('gates before financial reads when invoice access is absent', async () => {
    mocks.user.invoices.view = false;
    expect(await page()).toContain('You do not have access to invoice history.');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.workEnabled).not.toHaveBeenCalled();
    expect(mocks.findInvoiceItem).not.toHaveBeenCalled();
  });
  it('retains authorized issued history when new work is off', async () => {
    mocks.workEnabled.mockResolvedValue(false);
    expect(await page()).toContain('/invoices/manual');
  });
  it('retains the existing manage-only invoice read authority', async () => {
    mocks.user.invoices = { view: false, manage: true };
    expect(await page()).toContain('/invoices/manual');
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(companyId);
  });
  it('stops before invoice rows when the current availability read is denied', async () => {
    mocks.workEnabled.mockRejectedValue(new PermissionDeniedError());
    expect(await page()).toContain('You do not have access to invoice history.');
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('shows a legitimate empty history', async () => {
    mocks.list.mockResolvedValue([]);
    expect(await page()).toContain('No invoices for this client yet.');
  });
  it('separates a current read denial from a retryable lookup error', async () => {
    mocks.list.mockRejectedValue(new PermissionDeniedError());
    expect(await page()).toContain('You do not have access to invoice history.');
    mocks.list.mockRejectedValue(new Error('private database detail'));
    const html = await page();
    expect(html).toContain('Invoice history could not be loaded.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('private database detail');
  });
  it('uses the existing draft label and status presentation', async () => {
    const draft = summary('draft', 'manual', 'draft');
    draft.invoice.invoice_number = null;
    mocks.list.mockResolvedValue([draft]);
    const html = await page();
    expect(html).toContain('Pending');
    expect(html).toContain('Draft');
  });
});

describe('onboarding eligibility lookup', () => {
  it('only offers published account onboarding and uses the scoped candidate lookup', async () => {
    mocks.user.forms.assign = true;
    mocks.forms.mockResolvedValue([{ id: 'published', name: 'Published', form_type: 'onboarding', status: 'published' }, { id: 'draft', form_type: 'onboarding', status: 'draft' }, { id: 'intake', form_type: 'service_intake', status: 'published' }]);
    mocks.candidates.mockResolvedValue([{ profile_id: 'recipient', display_name: 'Synthetic recipient' }]);
    await page();
    expect(mocks.candidates).toHaveBeenCalledWith(companyId);
    expect(mocks.actions).toHaveBeenCalledWith(expect.objectContaining({ onboardingForms: [{ id: 'published', name: 'Published' }], eligibleProfiles: [{ id: 'recipient', label: 'Synthetic recipient' }] }));
  });
  it('treats failed eligibility lookup as a failure rather than an empty list', async () => {
    mocks.user.forms.assign = true;
    mocks.forms.mockRejectedValue(new Error('lookup failed'));
    expect(await page()).toContain('Unable to load this area.');
    expect(mocks.actions).not.toHaveBeenCalled();
  });
});

it('scopes invoice rows and latest successful payment dates to the requested company before requesting financials', async () => {
  const records = [summary('manual').invoice, summary('store', 'store_purchase', 'overdue').invoice, summary('cash-claim').invoice, { ...summary('other-company').invoice, company_id: 'other' }, { ...summary('archived').invoice, archived_at: 'now' }, { ...summary('other-tenant').invoice, tenant_id: 'foreign' }];
  const read = () => ({ data: records
    .filter(row => row.company_id === companyId && !row.archived_at && !('tenant_id' in row))
    .map(row => ({ ...row, invoice_payments: [{ id: 'settlement', processor: row.id === 'cash-claim' ? 'manual_invoice_claim' : null, settled_at: '2026-10-08' }] })), error: null });
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query), then: (resolve: (value: ReturnType<typeof read>) => unknown) => Promise.resolve(read()).then(resolve) };
  const events = {
    select: vi.fn(() => events),
    eq: vi.fn(() => events),
    filter: vi.fn(() => events),
    limit: vi.fn(async () => ({ data: [{ paid_at: '2026-10-05T12:00:00Z' }], error: null })),
  };
  const client = { from: vi.fn((table: string) => table === 'invoices' ? query : events), rpc: vi.fn(async (_: string, args: { p_invoice_id: string }) => ({ data: [{ invoice_id: args.p_invoice_id }], error: null })) };
  const service = new InvoiceService({ repository: new InvoiceRepository(client as unknown as UserMutationClient) });
  const result = await service.listForCompany(companyId);
  expect(query.select).toHaveBeenCalledWith('*, invoice_payments!invoice_payments_invoice_id_fkey(id, processor, settled_at)');
  expect(query.eq.mock.calls).toEqual([['company_id', companyId], ['invoice_payments.status', 'succeeded']]);
  expect(query.is).toHaveBeenCalledWith('archived_at', null);
  expect(query.order).toHaveBeenCalledWith('settled_at', { ascending: false, nullsFirst: false, referencedTable: 'invoice_payments' });
  expect(query.limit).toHaveBeenCalledWith(1, { referencedTable: 'invoice_payments' });
  expect(client.from.mock.calls).toEqual([['invoices'], ['activity_events']]);
  expect(events.eq.mock.calls).toEqual([['entity_type', 'invoice'], ['entity_id', 'cash-claim'], ['action', 'invoice.manual_payment.approved']]);
  expect(events.filter).toHaveBeenCalledExactlyOnceWith('metadata->>payment_id', 'eq', 'settlement');
  expect(result.map(row => row.invoice.id)).toEqual(['manual', 'store', 'cash-claim']);
  expect(result.map(row => row.paidAt)).toEqual(['2026-10-08', null, '2026-10-05T12:00:00Z']);
  expect(result[0]?.invoice).not.toHaveProperty('invoice_payments');
  expect(client.rpc.mock.calls).toEqual([['app_get_invoice_financials', { p_invoice_id: 'manual' }], ['app_get_invoice_financials', { p_invoice_id: 'store' }], ['app_get_invoice_financials', { p_invoice_id: 'cash-claim' }]]);
  await expect(async () => service.listForCompany('invalid')).rejects.toThrow();
});
