"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { TicketSummary } from "../../domain/tickets/schema";
import { formatDateTime } from "../../lib/format";
import { ticketPriorityOptions, ticketStatusOptions } from "../../lib/tickets/presentation";
import { TicketPriorityBadge, TicketStatusBadge } from "./ticket-badges";
import styles from "./tickets.module.css";

export function TicketsList({ summaries }: { summaries: TicketSummary[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return summaries.filter((ticket) => {
      const searchable = [ticket.public_ref, ticket.subject, ticket.company_name, ticket.client_name, ticket.assigned_to_name].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!term || searchable.includes(term)) && (status === "all" || ticket.status === status) && (priority === "all" || ticket.priority === priority);
    });
  }, [priority, query, status, summaries]);

  return <section className={styles.listSurface} aria-label="Tickets">
    <div className={styles.listToolbar}>
      <label className={styles.searchField}><Search aria-hidden="true" /><span className="sr-only">Search Tickets</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, subject, client…" /></label>
      <label><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{ticketStatusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label><span className="sr-only">Filter by priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option>{ticketPriorityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    </div>
    {visible.length === 0 ? <div className={styles.emptyState}><strong>{summaries.length === 0 ? "No Tickets yet." : "No Tickets match your filters."}</strong><p>{summaries.length === 0 ? "New client conversations will appear here." : "Try a broader search or clear a filter."}</p></div> : <>
      <div className={styles.tableWrap}><table><thead><tr><th>Ticket</th><th>Client / company</th><th>Status</th><th>Priority</th><th>Assigned</th><th>Last activity</th></tr></thead><tbody>{visible.map((ticket) => <tr key={ticket.ticket_id}><td><Link className={styles.ticketIdentity} href={`/tickets/${ticket.ticket_id}`}><strong>{ticket.public_ref}</strong><span>{ticket.subject}</span></Link></td><td><strong>{ticket.company_name ?? ticket.client_name ?? "Contact Form guest"}</strong>{ticket.client_name && ticket.company_name ? <span className={styles.cellSubline}>{ticket.client_name}</span> : null}</td><td><TicketStatusBadge status={ticket.status} /></td><td><TicketPriorityBadge priority={ticket.priority} /></td><td>{ticket.assigned_to_name ?? <span className={styles.muted}>Unassigned</span>}</td><td>{formatDateTime(ticket.last_message_at ?? ticket.updated_at)}</td></tr>)}</tbody></table></div>
      <div className={styles.mobileList}>{visible.map((ticket) => <Link href={`/tickets/${ticket.ticket_id}`} key={ticket.ticket_id}><header><strong>{ticket.public_ref}</strong><TicketStatusBadge status={ticket.status} /></header><h2>{ticket.subject}</h2><p>{ticket.company_name ?? ticket.client_name ?? "Contact Form guest"}</p><footer><TicketPriorityBadge priority={ticket.priority} /><span>{formatDateTime(ticket.last_message_at ?? ticket.updated_at)}</span></footer></Link>)}</div>
    </>}
  </section>;
}
