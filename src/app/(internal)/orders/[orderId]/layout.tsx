import type { Metadata } from "next";
import { BellRing, Building2, CalendarDays } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { OrderHeaderControls } from "../../../../components/projects/order-header-controls";
import { OrderTabs } from "../../../../components/projects/order-tabs";
import { OrderSectionContent, OrderSectionProvider } from "../../../../components/projects/order-section-transition";
import { ProjectBackToOrders } from "../../../../components/projects/project-back-to-orders";
import { RailDetailsToggle } from "../../../../components/projects/order-details-rail-toggle";
import styles from "../../../../components/projects/project-detail.module.css";
import { CopyValueButton } from "../../../../components/ui/copy-value-button";
import { DataError } from "../../../../components/ui/list-states";
import { PageFrame } from "../../../../components/ui/page-frame";
import { composeProjectTaskViews, projectNeedsAttention } from "../../../../domain/orders/projections";
import { orderReference } from "../../../../domain/orders/references";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatCurrencyCents, formatDate } from "../../../../lib/format";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Project" };

function humanizedOrigin(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default async function OrderDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const context = await getInternalContext();

  try {
    const [project, tasks, people] = await Promise.all([
      context.services.orders.getWithRelations(orderId),
      context.services.tasks.listForOrder(orderId),
      context.services.catalog.listAssignees(),
    ]);

    const canViewInvoices = context.user.invoices.view;

    const [invoiceItem, companyOrders] = await Promise.all([
      canViewInvoices ? context.services.invoices.findItemByOrderId(project.id) : Promise.resolve(null),
      context.services.orders.listForCompany(project.company_id),
    ]);

    const invoiceDetail = invoiceItem ? await context.services.invoices.get(invoiceItem.invoice_id) : null;
    const reference = orderReference(project);

    const relatedOrders = companyOrders
      .filter((order) => order.id !== project.id && !order.archived_at)
      .slice(0, 5);

    const { counts: taskCounts } = composeProjectTaskViews(tasks);
    const needsAttention = projectNeedsAttention(project.status, taskCounts);
    const peopleOptions = people.map((person) => ({
      id: person.id,
      name: person.displayName,
      avatarUrl: person.avatarUrl,
    }));

    return (
      <OrderSectionProvider><PageFrame
        className={styles.orderFrame}
        title={project.title}
        description={`Project #${reference} ${String.fromCharCode(183)} ${project.companies?.name ?? "Unavailable client"}`}
      >
        <nav className={styles.subnav} aria-label="Order sections">
          <div className={styles.subnavLeft}>
            <ProjectBackToOrders />
            <OrderTabs orderId={project.id} />
          </div>

          <OrderHeaderControls
            orderId={project.id}
            status={project.status}
            assigneeId={project.assigned_to_profile_id}
            people={peopleOptions}
            capabilities={context.user.projects}
          />
        </nav>

        {needsAttention ? (
          <p className={styles.attention}>
            <BellRing size={14} aria-hidden="true" />
            This project needs attention.
          </p>
        ) : null}

        <div className={styles.layout}>
          <div className={styles.main}><OrderSectionContent>{children}</OrderSectionContent></div>

          <aside className={styles.rail} aria-label="Order details" tabIndex={0}>
            <div className={styles.railCard}>
              <RailDetailsToggle>
              <dl className={styles.railList}>
                <div className={styles.railRow}>
                  <dt>Number</dt>
                  <dd className={styles.railInlineValue}>
                    {reference}
                    <CopyValueButton value={reference} label="Order number" />
                  </dd>
                </div>

                <div className={styles.railRow}>
                  <dt>Created</dt>
                  <dd className={styles.railInlineValue}>
                    <CalendarDays size={13} aria-hidden="true" />
                    {formatDate(project.created_at)}
                  </dd>
                </div>

                <div className={styles.railRow}>
                  <dt>Started</dt>
                  <dd className={styles.railInlineValue}>
                    {project.started_at ? (
                      <>
                        <CalendarDays size={13} aria-hidden="true" />
                        {formatDate(project.started_at)}
                      </>
                    ) : (
                      <span className={styles.muted}>Not started yet</span>
                    )}
                  </dd>
                </div>

                <div className={styles.railRow}>
                  <dt>Due</dt>
                  <dd className={styles.railInlineValue}>
                    {project.due_at ? (
                      <>
                        <CalendarDays size={13} aria-hidden="true" />
                        {formatDate(project.due_at)}
                      </>
                    ) : (
                      <span className={styles.muted}>No due date</span>
                    )}
                  </dd>
                </div>

                <div className={styles.railRow}>
                  <dt>Service</dt>
                  <dd>
                    {project.services ? (
                      <Link href={`/services/${project.services.id}`}>{project.services.name}</Link>
                    ) : (
                      <span className={styles.muted}>Unavailable</span>
                    )}
                  </dd>
                </div>

                {relatedOrders.length > 0 ? (
                  <div className={styles.railRow}>
                    <dt>Related orders</dt>
                    <dd>
                      <ul className={styles.railRelatedList}>
                        {relatedOrders.map((order) => (
                          <li key={order.id}>
                            <Link href={`/orders/${order.id}`}>{order.title}</Link>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}

                <div className={styles.railRow}>
                  <dt>Client</dt>
                  <dd>
                    {project.companies ? (
                      <Link href={`/clients/${project.companies.id}`} className={styles.railEntity}>
                        <span className={styles.railEntityIcon}>
                          <Building2 size={14} aria-hidden="true" />
                        </span>
                        {project.companies.name}
                      </Link>
                    ) : (
                      <span className={styles.muted}>Unavailable</span>
                    )}
                  </dd>
                </div>

                <div className={styles.railRow}>
                  <dt>Assigned to</dt>
                  <dd>
                    {project.profiles ? (
                      project.profiles.display_name ?? "Unnamed teammate"
                    ) : (
                      <span className={styles.muted}>Unassigned</span>
                    )}
                  </dd>
                </div>

                {invoiceDetail && invoiceItem ? (
                  <>
                    <div className={styles.railRow}>
                      <dt>Invoice</dt>
                      <dd>
                        <Link href={`/invoices/${invoiceDetail.invoice.id}`}>
                          {invoiceDetail.invoice.invoice_number
                            ? `Invoice #${invoiceDetail.invoice.invoice_number}`
                            : "View invoice"}
                        </Link>
                      </dd>
                    </div>

                    <div className={styles.railRow}>
                      {invoiceDetail.sourceHistory?.shared_orders.some((link) => link.invoice_item_id === invoiceItem.id) ? <>
                        <dt>Shared invoice line</dt>
                        <dd>{invoiceItem.quantity} units</dd>
                      </> : <>
                        <dt>Amount</dt>
                        <dd>{formatCurrencyCents(invoiceItem.line_subtotal_cents ?? 0, invoiceDetail.invoice.currency)}</dd>
                      </>}
                    </div>

                    {invoiceDetail.invoice.billing_reason ? (
                      <div className={styles.railRow}>
                        <dt>Origin</dt>
                        <dd>{humanizedOrigin(invoiceDetail.invoice.billing_reason)}</dd>
                      </div>
                    ) : null}

                    <div className={styles.railRow}>
                      <dt>Payments</dt>
                      <dd>
                        {invoiceDetail.payments.length === 0
                          ? <span className={styles.muted}>No payments yet</span>
                          : `${invoiceDetail.payments.length} payment${invoiceDetail.payments.length === 1 ? "" : "s"}`}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
              </RailDetailsToggle>
            </div>
          </aside>
        </div>
      </PageFrame></OrderSectionProvider>
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "NOT_FOUND") notFound();

    return (
      <PageFrame title="Project">
        <DataError message={safe.message} />
      </PageFrame>
    );
  }
}
