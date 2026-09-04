import { describe, expect, it, vi } from "vitest";
import type { OrderRow, OrderTaskRow } from "../lib/supabase/database-rows";
import { createUserSupabaseClient, verifyActor } from "../lib/supabase/user-client";
import { OrderService } from "../services/order-service";
import { TaskService } from "../services/task-service";
import { CompanyService } from "../services/company-service";
import { ContactService } from "../services/contact-service";
import { CatalogService } from "../services/catalog-service";

const actorId = "20000000-0000-4000-8000-000000000001";
const entityId = "50000000-0000-4000-8000-000000000001";
const completedAt = "2026-08-12T10:00:00.000Z";

async function verifiedActor() {
  const client = createUserSupabaseClient(
    { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "local-key" },
    "test-token",
  );
  vi.spyOn(client.auth, "getClaims").mockResolvedValue({ data: { claims: { sub: actorId } }, error: null } as never);
  return verifyActor(client);
}

function order(status: OrderRow["status"], completion: string | null): OrderRow {
  return { id: entityId, order_number: 42, company_id: actorId, service_id: actorId, assigned_to_profile_id: null, title: "Test", status, priority: "normal", due_at: null, started_at: null, completed_at: completion, notes: null, created_at: completedAt, updated_at: completedAt, archived_at: null };
}

function task(status: OrderTaskRow["status"], completion: string | null): OrderTaskRow {
  return { id: entityId, order_id: actorId, assigned_to_profile_id: null, title: "Task", description: null, status, due_at: null, sort_position: 0, completed_at: completion, created_at: completedAt, updated_at: completedAt, archived_at: null };
}

describe("atomic service orchestration", () => {
  it("delegates retry-safe service create with folder assignment", async () => {
    const actor = await verifiedActor();
    const repository = { create: vi.fn().mockResolvedValue({ id: entityId }) };
    const service = new CatalogService({ repository: repository as never });

    await service.create({
      request_id: actorId,
      name: "SEO Sprint",
      folder_id: entityId,
      price: 97,
      currency: "USD",
    }, actor);

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      request_id: actorId,
      name: "SEO Sprint",
      folder_id: entityId,
      price: 97,
    }));
  });

  it("delegates folder create and edit through audited repository operations", async () => {
    const actor = await verifiedActor();
    const repository = {
      createFolder: vi.fn().mockResolvedValue({ id: entityId }),
      updateFolder: vi.fn().mockResolvedValue({ id: entityId }),
    };
    const service = new CatalogService({ repository: repository as never });

    await service.createFolder({ request_id: actorId, name: "SEO Sprints" }, actor);
    await service.updateFolder(entityId, { description: "Edited" }, actor);

    expect(repository.createFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "SEO Sprints", sort_order: 0 }));
    expect(repository.updateFolder).toHaveBeenCalledWith(entityId, { description: "Edited" });
  });

  it("delegates service duplication with its stable request id", async () => {
    const actor = await verifiedActor();
    const repository = { duplicate: vi.fn().mockResolvedValue({ id: actorId }) };
    const service = new CatalogService({ repository: repository as never });

    await service.duplicate(entityId, actorId, actor);

    expect(repository.duplicate).toHaveBeenCalledWith(entityId, actorId);
  });

  it("delegates service and folder soft deletes", async () => {
    const actor = await verifiedActor();
    const repository = {
      archive: vi.fn().mockResolvedValue({ id: entityId }),
      archiveFolder: vi.fn().mockResolvedValue({ id: actorId }),
    };
    const service = new CatalogService({ repository: repository as never });

    await service.archive(entityId, actor);
    await service.archiveFolder(actorId, actor);

    expect(repository.archive).toHaveBeenCalledWith(entityId);
    expect(repository.archiveFolder).toHaveBeenCalledWith(actorId);
  });

  it("delegates order completion to one transactional repository operation", async () => {
    const actor = await verifiedActor();
    const repository = { changeStatus: vi.fn().mockResolvedValue(order("complete", completedAt)) };
    const service = new OrderService({ repository: repository as never });

    await service.changeStatus(entityId, { status: "complete" }, actor);

    expect(repository.changeStatus).toHaveBeenCalledOnce();
    expect(repository.changeStatus).toHaveBeenCalledWith(entityId, "complete");
  });

  it("delegates task reopening to one transactional repository operation", async () => {
    const actor = await verifiedActor();
    const repository = { changeStatus: vi.fn().mockResolvedValue(task("in_progress", null)) };
    const service = new TaskService({ repository: repository as never });

    await service.changeStatus(entityId, { status: "in_progress" }, actor);

    expect(repository.changeStatus).toHaveBeenCalledWith(entityId, "in_progress");
  });

  it("delegates assignment without a second activity write", async () => {
    const actor = await verifiedActor();
    const repository = { assign: vi.fn().mockResolvedValue(order("pending", null)) };
    const service = new OrderService({ repository: repository as never });

    await service.assign(entityId, actorId, actor);
    expect(repository.assign).toHaveBeenCalledWith(entityId, actorId);
  });

  it("delegates task reordering to one transactional repository operation", async () => {
    const actor = await verifiedActor();
    const repository = { reorder: vi.fn().mockResolvedValue({ ...task("todo", null), sort_position: 3 }) };
    const service = new TaskService({ repository: repository as never });

    await service.reorder(entityId, { sort_position: 3 }, actor);
    expect(repository.reorder).toHaveBeenCalledWith(entityId, 3);
  });

  it.each([
    ["client", (repository: never) => new CompanyService({ repository }), { name: "Renamed" }],
    ["contact", (repository: never) => new ContactService({ repository }), { name: "Renamed" }],
    ["service", (repository: never) => new CatalogService({ repository }), { name: "Renamed" }],
    ["project", (repository: never) => new OrderService({ repository }), { title: "Renamed" }],
    ["task", (repository: never) => new TaskService({ repository }), { title: "Renamed" }],
  ])("delegates %s updates to one transactional repository operation", async (_label, makeService, patch) => {
    const actor = await verifiedActor();
    const repository = { update: vi.fn().mockResolvedValue({ id: entityId }) };
    const service = makeService(repository as never);

    await service.update(entityId, patch, actor);

    expect(repository.update).toHaveBeenCalledOnce();
    expect(repository.update).toHaveBeenCalledWith(entityId, patch);
  });
});
