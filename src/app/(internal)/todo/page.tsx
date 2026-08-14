import type { Metadata } from "next";
import { DataError, EmptyState } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { StatusBadge } from "../../../components/ui/status-badge";
import type { Order } from "../../../domain/orders/schema";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { formatDate, isOverdue } from "../../../lib/format";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "To Do" };

function AttentionSection({ title, empty, orders, companyNames, serviceNames }: {
  title: string;
  empty: string;
  orders: Order[];
  companyNames: Map<string, string>;
  serviceNames: Map<string, string>;
}) {
  return (
    <section className="attention-section">
      <div className="section-heading"><h2>{title}</h2><span>{orders.length}</span></div>
      {orders.length ? (
        <div className="attention-rows">
          {orders.slice(0, 8).map((order) => (
            <article className="attention-row" key={order.id}>
              <div><strong>#{order.order_number} {order.title}</strong><span>{companyNames.get(order.company_id) ?? "Client unavailable"} · {serviceNames.get(order.service_id) ?? "Service unavailable"}</span></div>
              <StatusBadge status={order.status} />
              <time dateTime={order.due_at ?? undefined} className={isOverdue(order.due_at, order.status) ? "overdue" : ""}>{formatDate(order.due_at)}</time>
            </article>
          ))}
        </div>
      ) : <p className="compact-empty">{empty}</p>}
    </section>
  );
}

export default async function ToDoPage() {
  const context = await getInternalContext();
  try {
    const [orders, companies, services] = await Promise.all([
      context.services.orders.list(),
      context.services.companies.listActive(),
      context.services.catalog.listActive(),
    ]);
    const companyNames = new Map(companies.map((company) => [company.id, company.name]));
    const serviceNames = new Map(services.map((service) => [service.id, service.name]));
    const open = orders.filter((order) => !["complete", "canceled"].includes(order.status));
    const overdue = open.filter((order) => isOverdue(order.due_at, order.status)).sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
    const unassigned = open.filter((order) => order.assigned_to_profile_id === null);
    const waiting = open.filter((order) => order.status === "waiting_reply" || order.status === "pending_update");

    return (
      <PageFrame title="To Do" description="Work that needs attention now.">
        {orders.length === 0 ? (
          <EmptyState title="No projects yet" body="Projects are how work enters the platform." />
        ) : (
          <div className="attention-stack">
            <div className="attention-title"><span />Needs attention</div>
            {overdue.length === 0 && unassigned.length === 0 && waiting.length === 0 ? <p className="all-clear">Nothing needs attention right now.</p> : null}
            <AttentionSection title="Overdue" empty="Nothing overdue." orders={overdue} companyNames={companyNames} serviceNames={serviceNames} />
            <AttentionSection title="Unassigned" empty="Everything is assigned." orders={unassigned} companyNames={companyNames} serviceNames={serviceNames} />
            <AttentionSection title="Waiting on client" empty="Nothing is waiting on a client." orders={waiting} companyNames={companyNames} serviceNames={serviceNames} />
          </div>
        )}
      </PageFrame>
    );
  } catch (error) {
    return <PageFrame title="To Do"><DataError message={toClientSafeError(error).message} /></PageFrame>;
  }
}
