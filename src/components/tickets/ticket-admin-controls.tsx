"use client";

import { CheckCircle2, LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TicketCapabilities } from "../../domain/tickets/schema";
import type { ServiceAssigneeOption } from "../../repositories/service-repository";
import { assignTicketAction, updateTicketPriorityAction, updateTicketStatusAction } from "../../app/actions/tickets";
import { ticketPriorityOptions, ticketStatusLabels, ticketStatusOptions } from "../../lib/tickets/presentation";
import type { TicketPriority, TicketStatus } from "../../lib/tickets/types";
import { TicketOperationSelect } from "./ticket-operation-select";
import styles from "./tickets.module.css";

const transitions: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "waiting_on_client", "waiting_on_team", "resolved", "closed"],
  in_progress: ["open", "waiting_on_client", "waiting_on_team", "resolved", "closed"],
  waiting_on_client: ["open", "in_progress", "waiting_on_team", "resolved", "closed"],
  waiting_on_team: ["open", "in_progress", "waiting_on_client", "resolved", "closed"],
  resolved: ["open", "in_progress", "closed"],
  closed: ["open"],
};

export function TicketAdminControls({ ticketId, status, priority, assigneeId, assignees, capabilities }: { ticketId: string; status: TicketStatus; priority: TicketPriority; assigneeId: string | null; assignees: ServiceAssigneeOption[]; capabilities: TicketCapabilities }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(operation: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return <div className={styles.adminControls} aria-busy={pending || undefined}>
    {capabilities.edit ? <div className={styles.quickActions}>{status === "resolved" || status === "closed" ? <button type="button" onClick={() => run(() => updateTicketStatusAction(ticketId, "open"))} disabled={pending}><RotateCcw aria-hidden="true" />Reopen</button> : <button type="button" onClick={() => run(() => updateTicketStatusAction(ticketId, "resolved"))} disabled={pending}><CheckCircle2 aria-hidden="true" />Resolve</button>}{status === "resolved" ? <button type="button" onClick={() => run(() => updateTicketStatusAction(ticketId, "closed"))} disabled={pending}>Close</button> : null}</div> : null}
    <label><span>Status</span><TicketOperationSelect aria-label="Status" value={status} disabled={pending || !capabilities.edit} onChange={(event) => run(() => updateTicketStatusAction(ticketId, event.target.value))}><option value={status}>{ticketStatusLabels[status]}</option>{ticketStatusOptions.filter(([value]) => transitions[status].includes(value)).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</TicketOperationSelect></label>
    <label><span>Priority</span><TicketOperationSelect aria-label="Priority" value={priority} disabled={pending || !capabilities.edit} onChange={(event) => run(() => updateTicketPriorityAction(ticketId, event.target.value))}>{ticketPriorityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</TicketOperationSelect></label>
    <label><span>Assigned Wolf Forge member</span><TicketOperationSelect aria-label="Assigned Wolf Forge member" value={assigneeId ?? ""} disabled={pending || !capabilities.assign} onChange={(event) => run(() => assignTicketAction(ticketId, event.target.value || null))}><option value="">Unassigned</option>{assignees.map((assignee) => <option value={assignee.id} key={assignee.id}>{assignee.displayName}</option>)}</TicketOperationSelect></label>
    {pending ? <p className={styles.saving}><LoaderCircle className="spinner" aria-hidden="true" />Updating Ticket…</p> : null}
    {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
  </div>;
}
