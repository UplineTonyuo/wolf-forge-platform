import { describe, expect, it } from "vitest";
import {
  describeProjectBulkResult,
  describeProjectError,
  failedProjectBatch,
  runProjectBatch,
} from "../domain/orders/bulk";
import {
  applyProjectScopeFilters,
  composeProjectRows,
  composeProjectTaskViews,
  countProjectsByStatus,
  countProjectsNeedingAttention,
  emptyProjectFilterCriteria,
  filterProjectRows,
  matchesProjectSearch,
  projectInitials,
  projectNeedsAttention,
  summarizeProjectTasks,
  type ProjectRelationRow,
  type ProjectTaskFact,
} from "../domain/orders/projections";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "../lib/errors/application-error";
import type { OrderRow } from "../lib/supabase/database-rows";

const now = new Date("2026-08-13T12:00:00.000Z");

function relationRow(overrides: Partial<ProjectRelationRow> & { id: string }): ProjectRelationRow {
  const base: OrderRow = {
    reporting_period_month: null,
    id: overrides.id,
    order_number: 1,
    spp_order_reference: null,
    company_id: "c0000000-0000-4000-8000-000000000001",
    service_id: "50000000-0000-4000-8000-000000000001",
    assigned_to_profile_id: null,
    title: "Untitled",
    status: "pending",
    priority: "normal",
    due_at: null,
    started_at: null,
    completed_at: null,
    notes: null,
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T09:00:00.000Z",
    archived_at: null,
  };

  return {
    ...base,
    companies: { id: base.company_id, name: "Kraken Junk Removal" },
    services: { id: base.service_id, name: "SEO Sprint" },
    profiles: null,
    ...overrides,
  };
}

const orders: ProjectRelationRow[] = [
  relationRow({
    id: "10000000-0000-4000-8000-000000000001",
    order_number: 101,
    title: "Local SEO Growth Campaign",
    status: "working",
    profiles: { id: "a0000000-0000-4000-8000-000000000001", display_name: "Anthony Paghubasan", avatar_url: null },
    assigned_to_profile_id: "a0000000-0000-4000-8000-000000000001",
  }),
  relationRow({
    id: "10000000-0000-4000-8000-000000000002",
    order_number: 102,
    title: "Foundation Build",
    status: "waiting_reply",
    companies: { id: "c0000000-0000-4000-8000-000000000002", name: "Junk Buddies" },
    company_id: "c0000000-0000-4000-8000-000000000002",
  }),
  relationRow({
    id: "10000000-0000-4000-8000-000000000003",
    order_number: 103,
    title: "Maps Ranking Campaign",
    status: "pending",
    services: { id: "50000000-0000-4000-8000-000000000002", name: "Maps Sprint" },
    service_id: "50000000-0000-4000-8000-000000000002",
  }),
];

const taskFacts: ProjectTaskFact[] = [
  // Overdue and still open: this alone must trigger attention on project 3.
  { order_id: "10000000-0000-4000-8000-000000000003", status: "todo", due_at: "2026-08-01T09:00:00.000Z" },
  { order_id: "10000000-0000-4000-8000-000000000003", status: "complete", due_at: "2026-08-01T09:00:00.000Z" },
  // Overdue but already complete: must never count as attention.
  { order_id: "10000000-0000-4000-8000-000000000001", status: "complete", due_at: "2026-07-01T09:00:00.000Z" },
  { order_id: "10000000-0000-4000-8000-000000000001", status: "in_progress", due_at: null },
];

const rows = composeProjectRows(orders, taskFacts, now, [
  { order_id: orders[0]!.id, unanswered: true },
  { order_id: orders[1]!.id, unanswered: false },
  { order_id: orders[2]!.id, unanswered: true },
]);

describe("Projects read model", () => {
  it("resolves the authoritative client, service and assignee for every project", () => {
    expect(rows.map((row) => row.companyName)).toEqual([
      "Kraken Junk Removal",
      "Junk Buddies",
      "Kraken Junk Removal",
    ]);
    expect(rows.map((row) => row.serviceName)).toEqual(["SEO Sprint", "SEO Sprint", "Maps Sprint"]);
    expect(rows[0]!.assigneeName).toBe("Anthony Paghubasan");
    expect(rows[1]!.assigneeName).toBeNull();
    expect(rows[0]!.orderNumber).toBe(101);
  });

  it("counts tasks without treating completed overdue work as outstanding", () => {
    expect(rows[0]!.tasks).toEqual({ total: 2, open: 1, overdue: 0 });
    expect(rows[2]!.tasks).toEqual({ total: 2, open: 1, overdue: 1 });
    expect(rows[1]!.tasks).toEqual({ total: 0, open: 0, overdue: 0 });
  });

  it("summarizes tasks from the same rule the detail view uses", () => {
    expect(summarizeProjectTasks(taskFacts.slice(0, 2), now.getTime())).toEqual({
      total: 2,
      open: 1,
      overdue: 1,
    });
  });
});

describe("Projects attention rule", () => {
  it("flags waiting_reply, pending_update and overdue open tasks only", () => {
    const none = { total: 0, open: 0, overdue: 0 };
    expect(projectNeedsAttention("waiting_reply", none)).toBe(true);
    expect(projectNeedsAttention("pending_update", none)).toBe(true);
    expect(projectNeedsAttention("working", { total: 1, open: 1, overdue: 1 })).toBe(true);
    expect(projectNeedsAttention("working", none)).toBe(false);
    expect(projectNeedsAttention("complete", none)).toBe(false);
  });

  it("preserves the operational attention rule separately from public replies", () => {
    expect(countProjectsNeedingAttention(rows)).toBe(2);
    expect(rows.filter((row) => row.needsAttention).map((row) => row.id)).toEqual([orders[1]!.id, orders[2]!.id]);
  });

  it("applies the same overdue rule on the detail task view", () => {
    const detail = composeProjectTaskViews(
      [
        {
          id: "t1",
          order_id: "10000000-0000-4000-8000-000000000003",
          title: "Overdue task",
          status: "todo",
          due_at: "2026-08-01T09:00:00.000Z",
          assigned_to_profile_id: null,
        },
        {
          id: "t2",
          order_id: "10000000-0000-4000-8000-000000000003",
          title: "Done task",
          status: "complete",
          due_at: "2026-08-01T09:00:00.000Z",
          assigned_to_profile_id: null,
        },
      ],
      now,
    );

    expect(detail.views.map((view) => view.overdue)).toEqual([true, false]);
    expect(detail.counts).toEqual({ total: 2, open: 1, overdue: 1 });
    expect(detail.needsAttentionFromTasks).toBe(true);
    expect(detail.views[0]!.statusLabel).toBe("To do");
  });
});

describe("Projects counts and filtering", () => {
  it("keeps every tab count equal to the rows that tab renders", () => {
    const criteria = { ...emptyProjectFilterCriteria };
    const counts = countProjectsByStatus(rows, criteria);

    for (const tab of ["pending", "submitted", "working", "waiting_reply", "pending_update", "complete", "canceled", "all"] as const) {
      expect(filterProjectRows(rows, { ...criteria, tab })).toHaveLength(counts[tab]);
    }

    expect(counts.all).toBe(3);
    expect(counts.working).toBe(1);
    expect(counts.waiting_reply).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.complete).toBe(0);
  });

  it("keeps counts and rows in agreement while other filters are active", () => {
    const criteria = { ...emptyProjectFilterCriteria, unansweredOnly: true };
    const counts = countProjectsByStatus(rows, criteria);

    expect(counts.all).toBe(2);
    expect(filterProjectRows(rows, { ...criteria, tab: "all" })).toHaveLength(2);
    expect(filterProjectRows(rows, { ...criteria, tab: "working" })).toHaveLength(counts.working);
  });

  it("filters by assignee, unassigned, service and client", () => {
    expect(
      applyProjectScopeFilters(rows, {
        ...emptyProjectFilterCriteria,
        assigneeId: "a0000000-0000-4000-8000-000000000001",
      }).map((row) => row.orderNumber),
    ).toEqual([101]);

    expect(
      applyProjectScopeFilters(rows, { ...emptyProjectFilterCriteria, assigneeId: "unassigned" }).map(
        (row) => row.orderNumber,
      ),
    ).toEqual([102, 103]);

    expect(
      applyProjectScopeFilters(rows, {
        ...emptyProjectFilterCriteria,
        serviceId: "50000000-0000-4000-8000-000000000002",
      }).map((row) => row.orderNumber),
    ).toEqual([103]);

    expect(
      applyProjectScopeFilters(rows, {
        ...emptyProjectFilterCriteria,
        companyId: "c0000000-0000-4000-8000-000000000002",
      }).map((row) => row.orderNumber),
    ).toEqual([102]);
  });
});

describe("Projects search", () => {
  it("matches project title, project number and client name", () => {
    expect(matchesProjectSearch(rows[0]!, "growth")).toBe(true);
    expect(matchesProjectSearch(rows[0]!, "LOCAL seo")).toBe(true);
    expect(matchesProjectSearch(rows[0]!, "101")).toBe(true);
    expect(matchesProjectSearch(rows[0]!, "#101")).toBe(true);
    expect(matchesProjectSearch(rows[1]!, "junk buddies")).toBe(true);
    expect(matchesProjectSearch(rows[1]!, "kraken")).toBe(false);
    expect(matchesProjectSearch(rows[0]!, "")).toBe(true);
  });

  it("narrows the rendered rows and the counts together", () => {
    const criteria = { ...emptyProjectFilterCriteria, search: "junk buddies" };
    expect(countProjectsByStatus(rows, criteria).all).toBe(1);
    expect(filterProjectRows(rows, { ...criteria, tab: "all" })).toHaveLength(1);
  });
});

describe("Project initials", () => {
  it("derives initials from real display names and degrades safely", () => {
    expect(projectInitials("Anthony Paghubasan")).toBe("AP");
    expect(projectInitials("Isaiah")).toBe("IS");
    expect(projectInitials(null)).toBe("?");
  });
});

describe("Projects bulk outcomes", () => {
  it("reports each project separately and never hides a partial failure", async () => {
    const result = await runProjectBatch(
      ["a", "b", "c"],
      (id) => `#${id.toUpperCase()} Project`,
      async (id) => {
        if (id === "b") throw new PermissionDeniedError();
        return id;
      },
      "rejected",
    );

    expect(result.attempted).toBe(3);
    expect(result.succeeded.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(result.failed).toEqual([
      { id: "b", label: "#B Project", error: "You do not have permission to perform this action." },
    ]);
    expect(describeProjectBulkResult(result)).toBe("2 of 3 projects updated. 1 failed.");
  });

  it("de-duplicates ids so one project is never operated on twice", async () => {
    const seen: string[] = [];
    const result = await runProjectBatch(
      ["a", "a", "", "b"],
      () => "label",
      async (id) => {
        seen.push(id);
      },
      "rejected",
    );

    expect(seen).toEqual(["a", "b"]);
    expect(result.attempted).toBe(2);
  });

  it("summarizes honestly for full success, total failure and empty selection", () => {
    expect(describeProjectBulkResult({ attempted: 1, succeeded: [{ id: "a", label: "x" }], failed: [] })).toBe(
      "1 project updated.",
    );
    expect(
      describeProjectBulkResult({
        attempted: 2,
        succeeded: [
          { id: "a", label: "x" },
          { id: "b", label: "y" },
        ],
        failed: [],
      }),
    ).toBe("2 projects updated.");
    expect(
      describeProjectBulkResult({ attempted: 1, succeeded: [], failed: [{ id: "a", label: "x", error: "no" }] }),
    ).toBe("No projects were updated. 1 failed.");
    expect(describeProjectBulkResult({ attempted: 0, succeeded: [], failed: [] })).toBe(
      "No projects were selected.",
    );
  });

  it("translates application errors into user-safe copy without leaking database text", () => {
    expect(describeProjectError(new ValidationError("raw"), "Check the project.")).toBe("Check the project.");
    expect(describeProjectError(new PermissionDeniedError(), "x")).toBe(
      "You do not have permission to perform this action.",
    );
    expect(describeProjectError(new NotFoundError("Project"), "x")).toBe("That project is no longer available.");
    expect(describeProjectError(new Error("duplicate key value violates unique constraint"), "x")).toBe(
      "The operation failed.",
    );
  });

  it("builds an all-failed batch without claiming any success", () => {
    const result = failedProjectBatch([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ], "Choose a valid project status.");
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.attempted).toBe(2);
  });
});
