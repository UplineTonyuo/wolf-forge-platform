import type { OrderRow } from "../../lib/supabase/database-rows";
import { formatShortDate } from "../../lib/format";
import type { OrderPriority, OrderStatus } from "./schema";

/**
 * User-facing Project labels for the canonical order status domain. The backend
 * keeps the historical `order` naming; only the presentation says "Project".
 */
export const projectStatusLabels: Record<OrderStatus, string> = {
  pending: "Pending",
  submitted: "Submitted",
  working: "Working",
  waiting_reply: "Waiting on client",
  pending_update: "Needs update",
  complete: "Complete",
  canceled: "Canceled",
};

export const projectPriorityLabels: Record<OrderPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Task statuses that still represent outstanding delivery work. */
const openTaskStatuses = new Set(["todo", "in_progress", "blocked"]);

/** Shape returned by the embedded Projects read query. */
export type ProjectRelationRow = OrderRow & {
  companies: { id: string; name: string } | null;
  services: { id: string; name: string } | null;
  profiles: { id: string; display_name: string | null } | null;
};

/** Minimal task facts required for attention and the Info column. */
export type ProjectTaskFact = {
  order_id: string;
  status: string;
  due_at: string | null;
};

export type ProjectTaskCounts = {
  total: number;
  open: number;
  overdue: number;
};

export type ProjectListRow = {
  id: string;
  orderNumber: number;
  title: string;
  status: OrderStatus;
  priority: OrderPriority;
  createdAt: string;
  createdLabel: string;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  companyId: string;
  companyName: string | null;
  serviceId: string;
  serviceName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  tasks: ProjectTaskCounts;
  needsAttention: boolean;
};

export type ProjectTab = OrderStatus | "all";

/**
 * Capability flags used to decide which controls to render. They are affordance
 * hints only: the database triggers remain the authority on every mutation.
 */
export type ProjectCapabilities = {
  create: boolean;
  edit: boolean;
  assign: boolean;
  archive: boolean;
};

export type ProjectFilterCriteria = {
  tab: ProjectTab;
  search: string;
  assigneeId: string;
  serviceId: string;
  companyId: string;
  attentionOnly: boolean;
};

export const emptyProjectFilterCriteria: ProjectFilterCriteria = {
  tab: "all",
  search: "",
  assigneeId: "all",
  serviceId: "all",
  companyId: "all",
  attentionOnly: false,
};

/**
 * The single Project attention rule. The banner count, the "View" filter and
 * any attention affordance all read the boolean produced here, so the three can
 * never disagree.
 *
 * A Project needs attention when it is waiting on the client, needs an update,
 * or carries at least one still-open task whose due date has passed.
 */
export function projectNeedsAttention(status: OrderStatus, tasks: ProjectTaskCounts): boolean {
  return status === "waiting_reply" || status === "pending_update" || tasks.overdue > 0;
}

export function summarizeProjectTasks(facts: ProjectTaskFact[], now: number): ProjectTaskCounts {
  let total = 0;
  let open = 0;
  let overdue = 0;

  for (const fact of facts) {
    total += 1;
    if (!openTaskStatuses.has(fact.status)) continue;
    open += 1;
    if (fact.due_at && new Date(fact.due_at).getTime() < now) overdue += 1;
  }

  return { total, open, overdue };
}

function displayName(profile: ProjectRelationRow["profiles"]): string | null {
  if (!profile) return null;
  const name = profile.display_name?.trim();
  return name ? name : "Unnamed teammate";
}

export function composeProjectRows(
  orders: ProjectRelationRow[],
  taskFacts: ProjectTaskFact[],
  now: Date = new Date(),
): ProjectListRow[] {
  const timestamp = now.getTime();
  const factsByOrder = new Map<string, ProjectTaskFact[]>();

  for (const fact of taskFacts) {
    const existing = factsByOrder.get(fact.order_id);
    if (existing) existing.push(fact);
    else factsByOrder.set(fact.order_id, [fact]);
  }

  return orders.map((order) => {
    const tasks = summarizeProjectTasks(factsByOrder.get(order.id) ?? [], timestamp);

    return {
      id: order.id,
      orderNumber: order.order_number,
      title: order.title,
      status: order.status,
      priority: order.priority,
      createdAt: order.created_at,
      createdLabel: formatShortDate(order.created_at),
      dueAt: order.due_at,
      startedAt: order.started_at,
      completedAt: order.completed_at,
      companyId: order.company_id,
      companyName: order.companies?.name ?? null,
      serviceId: order.service_id,
      serviceName: order.services?.name ?? null,
      assigneeId: order.assigned_to_profile_id,
      assigneeName: displayName(order.profiles),
      tasks,
      needsAttention: projectNeedsAttention(order.status, tasks),
    };
  });
}

export const projectTaskStatusLabels: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  complete: "Complete",
  canceled: "Canceled",
};

export type ProjectTaskView = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  assigneeId: string | null;
  dueAt: string | null;
  overdue: boolean;
};

export type ProjectDetailTasks = {
  views: ProjectTaskView[];
  counts: ProjectTaskCounts;
  needsAttentionFromTasks: boolean;
};

/**
 * Detail-page task view. The overdue flag is computed here, from the same rule
 * summarizeProjectTasks uses, so the list and the detail page cannot diverge.
 */
export function composeProjectTaskViews(
  tasks: Array<{
    id: string;
    order_id: string;
    title: string;
    status: string;
    due_at: string | null;
    assigned_to_profile_id: string | null;
  }>,
  now: Date = new Date(),
): ProjectDetailTasks {
  const timestamp = now.getTime();
  const counts = summarizeProjectTasks(
    tasks.map((task) => ({ order_id: task.order_id, status: task.status, due_at: task.due_at })),
    timestamp,
  );

  const views = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    statusLabel: projectTaskStatusLabels[task.status] ?? task.status,
    assigneeId: task.assigned_to_profile_id,
    dueAt: task.due_at,
    overdue:
      openTaskStatuses.has(task.status) &&
      Boolean(task.due_at) &&
      new Date(task.due_at as string).getTime() < timestamp,
  }));

  return { views, counts, needsAttentionFromTasks: counts.overdue > 0 };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Matches Project title, database-generated Project number and Client name. */
export function matchesProjectSearch(row: ProjectListRow, search: string): boolean {
  const query = normalize(search);
  if (!query) return true;

  if (normalize(row.title).includes(query)) return true;
  if (row.companyName && normalize(row.companyName).includes(query)) return true;
  if (row.serviceName && normalize(row.serviceName).includes(query)) return true;

  const numberQuery = query.replace(/^#/u, "");
  return numberQuery.length > 0 && String(row.orderNumber).includes(numberQuery);
}

/** Applies every criterion except the status tab. */
export function applyProjectScopeFilters(
  rows: ProjectListRow[],
  criteria: ProjectFilterCriteria,
): ProjectListRow[] {
  return rows.filter((row) => {
    if (criteria.attentionOnly && !row.needsAttention) return false;

    if (criteria.assigneeId === "unassigned") {
      if (row.assigneeId !== null) return false;
    } else if (criteria.assigneeId !== "all" && row.assigneeId !== criteria.assigneeId) {
      return false;
    }

    if (criteria.serviceId !== "all" && row.serviceId !== criteria.serviceId) return false;
    if (criteria.companyId !== "all" && row.companyId !== criteria.companyId) return false;

    return matchesProjectSearch(row, criteria.search);
  });
}

export function filterProjectRows(
  rows: ProjectListRow[],
  criteria: ProjectFilterCriteria,
): ProjectListRow[] {
  const scoped = applyProjectScopeFilters(rows, criteria);
  if (criteria.tab === "all") return scoped;
  return scoped.filter((row) => row.status === criteria.tab);
}

export type ProjectStatusCounts = Record<ProjectTab, number>;

/**
 * Counts are derived from the same scoped set the table renders, so a tab that
 * advertises N always resolves to exactly N rows.
 */
export function countProjectsByStatus(
  rows: ProjectListRow[],
  criteria: ProjectFilterCriteria,
): ProjectStatusCounts {
  const scoped = applyProjectScopeFilters(rows, criteria);
  const counts = {
    pending: 0,
    submitted: 0,
    working: 0,
    waiting_reply: 0,
    pending_update: 0,
    complete: 0,
    canceled: 0,
    all: scoped.length,
  } satisfies ProjectStatusCounts;

  for (const row of scoped) counts[row.status] += 1;
  return counts;
}

export function countProjectsNeedingAttention(rows: ProjectListRow[]): number {
  return rows.reduce((total, row) => (row.needsAttention ? total + 1 : total), 0);
}

export function projectInitials(name: string | null): string {
  if (!name) return "—";
  const parts = name.split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toLocaleUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toLocaleUpperCase();
}
