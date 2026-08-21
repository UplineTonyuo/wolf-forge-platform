import { formatDate } from "../../lib/format";
import type { ProjectTaskCounts } from "./projections";
import { projectStatusLabels } from "./projections";
import type { OrderStatus } from "./schema";

/**
 * The client-facing Project read model.
 *
 * The caller-scoped Project RPC decides both which rows and which columns may
 * reach the portal. Direct client SELECT on orders/order_tasks is denied.
 *
 * Deliberately absent, and asserted absent by test:
 *   - notes                   internal working notes
 *   - assigned_to_profile_id  internal staff identity
 *   - individual task titles  internal operational phrasing
 *
 * Tasks contribute aggregate counts inside the database RPC. No individual
 * task row enters the client read model.
 */
export type ClientProjectSourceRow = {
  id: string;
  order_number: number;
  title: string;
  status: OrderStatus;
  created_at: string;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  service_name: string | null;
  task_total: number;
  task_open: number;
};

export type ClientProjectProgress = {
  total: number;
  completed: number;
  /** 0–100, or null when the project has no tasks to measure against. */
  percent: number | null;
};

export type ClientProjectView = {
  id: string;
  reference: string;
  title: string;
  status: OrderStatus;
  statusLabel: string;
  serviceName: string | null;
  createdLabel: string;
  dueLabel: string | null;
  startedLabel: string | null;
  completedLabel: string | null;
  progress: ClientProjectProgress;
};

/** Statuses a client reads as "still being worked on". */
const openStatuses = new Set<OrderStatus>([
  "pending",
  "submitted",
  "working",
  "waiting_reply",
  "pending_update",
]);

export function clientProjectIsOpen(status: OrderStatus): boolean {
  return openStatuses.has(status);
}

export function projectReference(orderNumber: number): string {
  return `WF-P${String(orderNumber).padStart(4, "0")}`;
}

function toProgress(counts: ProjectTaskCounts): ClientProjectProgress {
  const completed = counts.total - counts.open;
  return {
    total: counts.total,
    completed,
    percent: counts.total === 0 ? null : Math.round((completed / counts.total) * 100),
  };
}

export function composeClientProjectViews(
  rows: ClientProjectSourceRow[],
): ClientProjectView[] {
  return rows.map((row) => ({
    id: row.id,
    reference: projectReference(row.order_number),
    title: row.title,
    status: row.status,
    statusLabel: projectStatusLabels[row.status] ?? row.status,
    serviceName: row.service_name,
    createdLabel: formatDate(row.created_at),
    dueLabel: row.due_at ? formatDate(row.due_at) : null,
    startedLabel: row.started_at ? formatDate(row.started_at) : null,
    completedLabel: row.completed_at ? formatDate(row.completed_at) : null,
    progress: toProgress({
      total: row.task_total,
      open: row.task_open,
      overdue: 0,
    }),
  }));
}

export function countOpenClientProjects(views: ClientProjectView[]): number {
  return views.reduce((total, view) => (clientProjectIsOpen(view.status) ? total + 1 : total), 0);
}
