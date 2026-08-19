import { formatDate } from "../../lib/format";
import type { ProjectTaskCounts, ProjectTaskFact } from "./projections";
import { projectStatusLabels, summarizeProjectTasks } from "./projections";
import type { OrderStatus } from "./schema";

/**
 * The client-facing Project read model.
 *
 * public.orders is company-scoped for a client by
 * orders_client_select_own_company, so RLS already decides which rows exist.
 * What this module decides is which *columns* ever reach the portal.
 *
 * Deliberately absent, and asserted absent by test:
 *   - notes                   internal working notes
 *   - assigned_to_profile_id  internal staff identity
 *   - individual task titles  internal operational phrasing
 *
 * Tasks contribute aggregate counts only. The repository selects an explicit
 * column list rather than `*`, so a column added to orders later cannot appear
 * here without someone choosing it.
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
  services: { name: string } | null;
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
  taskFacts: ProjectTaskFact[],
  now: Date = new Date(),
): ClientProjectView[] {
  const timestamp = now.getTime();
  const factsByOrder = new Map<string, ProjectTaskFact[]>();

  for (const fact of taskFacts) {
    const existing = factsByOrder.get(fact.order_id);
    if (existing) existing.push(fact);
    else factsByOrder.set(fact.order_id, [fact]);
  }

  return rows.map((row) => ({
    id: row.id,
    reference: projectReference(row.order_number),
    title: row.title,
    status: row.status,
    statusLabel: projectStatusLabels[row.status] ?? row.status,
    serviceName: row.services?.name ?? null,
    createdLabel: formatDate(row.created_at),
    dueLabel: row.due_at ? formatDate(row.due_at) : null,
    startedLabel: row.started_at ? formatDate(row.started_at) : null,
    completedLabel: row.completed_at ? formatDate(row.completed_at) : null,
    progress: toProgress(summarizeProjectTasks(factsByOrder.get(row.id) ?? [], timestamp)),
  }));
}

export function countOpenClientProjects(views: ClientProjectView[]): number {
  return views.reduce((total, view) => (clientProjectIsOpen(view.status) ? total + 1 : total), 0);
}
