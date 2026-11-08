import { describe, expect, it, vi } from "vitest";
import type { ProjectRelationRow } from "../domain/orders/projections";
import { createUserSupabaseClient, verifyActor } from "../lib/supabase/user-client";
import { OrderService } from "../services/order-service";

const actorId = "20000000-0000-4000-8000-000000000001";
const orderId = "10000000-0000-4000-8000-000000000001";
const companyId = "c0000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";

async function verifiedActor() {
  const client = createUserSupabaseClient(
    { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "local-key" },
    "test-token",
  );
  vi.spyOn(client.auth, "getClaims").mockResolvedValue({
    data: { claims: { sub: actorId } },
    error: null,
  } as never);
  return verifyActor(client);
}

function relationRow(id: string, overrides: Partial<ProjectRelationRow> = {}): ProjectRelationRow {
  return {
    reporting_period_month: null,
    id,
    order_number: 42,
    company_id: companyId,
    service_id: serviceId,
    assigned_to_profile_id: null,
    title: "Local SEO Growth Campaign",
    status: "working",
    priority: "normal",
    due_at: null,
    started_at: null,
    completed_at: null,
    notes: null,
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T09:00:00.000Z",
    archived_at: null,
    companies: { id: companyId, name: "Kraken Junk Removal" },
    services: { id: serviceId, name: "SEO Sprint" },
    profiles: null,
    ...overrides,
  };
}

describe("OrderService project read model", () => {
  it("resolves orders, tasks and reply metadata in bounded batches, never one per row", async () => {
    const repository = {
      listWithRelations: vi.fn().mockResolvedValue({
        rows: [relationRow(orderId), relationRow("10000000-0000-4000-8000-000000000002")],
        totalCount: 2,
      }),
      listTaskFacts: vi.fn().mockResolvedValue([
        { order_id: orderId, status: "todo", due_at: null },
      ]),
      listResponseStates: vi.fn().mockResolvedValue([]),
    };

    const service = new OrderService({ repository: repository as never });
    const result = await service.listProjects();

    expect(repository.listWithRelations).toHaveBeenCalledTimes(1);
    expect(repository.listTaskFacts).toHaveBeenCalledTimes(1);
    expect(repository.listTaskFacts).toHaveBeenCalledWith([
      orderId,
      "10000000-0000-4000-8000-000000000002",
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.companyName).toBe("Kraken Junk Removal");
    expect(result.rows[0]!.tasks.total).toBe(1);
    expect(result.complete).toBe(true);
  });

  it("passes client, service, assignee and status filters through to the repository", async () => {
    const repository = {
      listWithRelations: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      listTaskFacts: vi.fn().mockResolvedValue([]),
      listResponseStates: vi.fn().mockResolvedValue([]),
    };

    const service = new OrderService({ repository: repository as never });
    await service.listProjects({
      companyId,
      serviceId,
      assignedToProfileId: actorId,
      status: "working",
    });

    expect(repository.listWithRelations).toHaveBeenCalledWith({
      companyId,
      serviceId,
      assignedToProfileId: actorId,
      status: "working",
    });
    expect(repository.listTaskFacts).toHaveBeenCalledWith([]);
  });

  it("reports an incomplete dataset instead of presenting partial totals as complete", async () => {
    const repository = {
      listWithRelations: vi.fn().mockResolvedValue({ rows: [relationRow(orderId)], totalCount: 9000 }),
      listTaskFacts: vi.fn().mockResolvedValue([]),
      listResponseStates: vi.fn().mockResolvedValue([]),
    };

    const service = new OrderService({ repository: repository as never });
    const result = await service.listProjects();

    expect(result.complete).toBe(false);
    expect(result.totalCount).toBe(9000);
  });
});

describe("OrderService project mutations", () => {
  it("creates a project through the audited repository with a retry-safe request id", async () => {
    const actor = await verifiedActor();
    const repository = { create: vi.fn().mockResolvedValue({ id: orderId }) };
    const service = new OrderService({ repository: repository as never });

    await service.create(
      {
        request_id: "93000000-0000-4000-8000-000000000001",
        company_id: companyId,
        service_id: serviceId,
        title: "Local SEO Growth Campaign",
        priority: "high",
        notes: "Internal only",
      },
      actor,
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: "93000000-0000-4000-8000-000000000001",
        company_id: companyId,
        service_id: serviceId,
        title: "Local SEO Growth Campaign",
        priority: "high",
      }),
    );
  });

  it("rejects create input before it reaches the database", async () => {
    const actor = await verifiedActor();
    const repository = { create: vi.fn() };
    const service = new OrderService({ repository: repository as never });

    await expect(
      service.create({ company_id: companyId, service_id: serviceId, title: "   " }, actor),
    ).rejects.toThrow("The supplied data is invalid.");
    await expect(
      service.create({ company_id: "not-a-uuid", service_id: serviceId, title: "Valid" }, actor),
    ).rejects.toThrow("The supplied data is invalid.");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("refuses to send an unverified actor into a mutation", async () => {
    const repository = { create: vi.fn(), archive: vi.fn() };
    const service = new OrderService({ repository: repository as never });
    const forged = { id: actorId } as never;

    await expect(
      service.create({ company_id: companyId, service_id: serviceId, title: "Forged" }, forged),
    ).rejects.toThrow("server-verified actor");
    await expect(service.archive(orderId, forged)).rejects.toThrow("server-verified actor");
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.archive).not.toHaveBeenCalled();
  });

  it("never lets an update patch carry a client reassignment", async () => {
    const actor = await verifiedActor();
    const repository = { update: vi.fn().mockResolvedValue({ id: orderId }) };
    const service = new OrderService({ repository: repository as never });

    await expect(
      service.update(orderId, { company_id: "c0000000-0000-4000-8000-000000000002" }, actor),
    ).rejects.toThrow("The supplied data is invalid.");

    await service.update(orderId, { title: "Renamed project" }, actor);
    expect(repository.update).toHaveBeenCalledWith(orderId, { title: "Renamed project" });
  });

  it("validates the requested status against the canonical project domain", async () => {
    const actor = await verifiedActor();
    const repository = { changeStatus: vi.fn().mockResolvedValue({ id: orderId }) };
    const service = new OrderService({ repository: repository as never });

    await service.changeStatus(orderId, { status: "complete" }, actor);
    expect(repository.changeStatus).toHaveBeenCalledWith(orderId, "complete");

    await expect(service.changeStatus(orderId, { status: "archived" }, actor)).rejects.toThrow(
      "The supplied data is invalid.",
    );
  });

  it("assigns and unassigns through the audited assignment path only", async () => {
    const actor = await verifiedActor();
    const repository = { assign: vi.fn().mockResolvedValue({ id: orderId }) };
    const service = new OrderService({ repository: repository as never });

    await service.assign(orderId, actorId, actor);
    expect(repository.assign).toHaveBeenCalledWith(orderId, actorId);

    await service.assign(orderId, null, actor);
    expect(repository.assign).toHaveBeenCalledWith(orderId, null);

    await expect(service.assign(orderId, "someone", actor)).rejects.toThrow(
      "The supplied data is invalid.",
    );
  });

  it("archives through the audited archive path", async () => {
    const actor = await verifiedActor();
    const repository = { archive: vi.fn().mockResolvedValue({ id: orderId, archived_at: "now" }) };
    const service = new OrderService({ repository: repository as never });

    await service.archive(orderId, actor);
    expect(repository.archive).toHaveBeenCalledWith(orderId);
  });

  it("validates every id it forwards for label resolution", async () => {
    const repository = { listLabels: vi.fn().mockResolvedValue([]) };
    const service = new OrderService({ repository: repository as never });

    await service.listLabels([orderId]);
    expect(repository.listLabels).toHaveBeenCalledWith([orderId]);
    await expect(service.listLabels(["not-a-uuid"])).rejects.toThrow("The supplied data is invalid.");
  });
});
