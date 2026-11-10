import { describe, expect, it, vi } from "vitest";
import { OrderRepository } from "../repositories/order-repository";
import { ServiceRepository } from "../repositories/service-repository";

function fixture(assigned = true) {
  const row = { id: "project", assigned_to_profile_id: assigned ? "member" : null, companies: null, services: null };
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn() };
  for (const method of [query.select, query.eq, query.is, query.order]) method.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [row], error: null, count: 1 });
  query.single.mockResolvedValue({ data: row, error: null });
  const client = { from: vi.fn().mockReturnValue(query), rpc: vi.fn().mockResolvedValue({ data: [{ profile_id: "member", display_name: "Synthetic member", avatar_url: "/synthetic-avatar.png" }], error: null }) };
  return { query, client, repository: new OrderRepository(client as never) };
}
describe("Tenant membership Project relationships", () => {
  it("makes IDs available with exact count and every filter before hydration", async () => {
    const { query, client, repository } = fixture();
    const page = await repository.listRelationRows({ companyId: "company", serviceId: "service", assignedToProfileId: "member", status: "working" });
    expect(page.rows[0]?.id).toBe("project");
    expect(page.totalCount).toBe(1);
    expect(query.select).toHaveBeenCalledWith("*, companies(id, name), services(id, name)", { count: "exact" });
    expect(query.eq.mock.calls).toEqual([["company_id", "company"], ["service_id", "service"], ["assigned_to_profile_id", "member"], ["status", "working"]]);
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(2000);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("shares raw assignees between filters and row hydration without replacing a null name", async () => {
    const { query, client } = fixture();
    client.rpc.mockResolvedValue({ data: [
      { profile_id: "member", display_name: null, avatar_url: null },
      { profile_id: "other", display_name: "Alice", avatar_url: "/alice.png" },
    ], error: null } as never);
    const catalog = new ServiceRepository(client as never);
    const repository = new OrderRepository(client as never, () => catalog.listOperationalAssignees());
    const [people, page] = await Promise.all([catalog.listAssignees(), repository.listWithRelations()]);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("app_list_operational_assignees");
    expect(people).toEqual([
      { id: "other", displayName: "Alice", avatarUrl: "/alice.png" },
      { id: "member", displayName: "Unnamed teammate", avatarUrl: null },
    ]);
    expect(page.rows[0]?.profiles).toEqual({ id: "member", display_name: null, avatar_url: null });
    expect(query.limit).toHaveBeenCalledWith(2000);
    expect(page.totalCount).toBe(1);
  });

  it("keeps independent request-owned catalog results separate", async () => {
    const first = fixture();
    const second = fixture();
    second.client.rpc.mockResolvedValue({ data: [{ profile_id: "member", display_name: "Second workspace", avatar_url: null }], error: null } as never);
    const catalogs = [new ServiceRepository(first.client as never), new ServiceRepository(second.client as never)];
    const [left, right] = await Promise.all(catalogs.map((catalog) => catalog.listAssignees()));
    expect(left?.[0]?.displayName).toBe("Synthetic member");
    expect(right?.[0]?.displayName).toBe("Second workspace");
    expect(first.client.rpc).toHaveBeenCalledTimes(1);
    expect(second.client.rpc).toHaveBeenCalledTimes(1);
  });

  it("leaves an assigned profile unknown when absent from the authorized result", async () => {
    const { client, repository } = fixture();
    client.rpc.mockResolvedValue({ data: [], error: null });
    expect((await repository.listWithRelations()).rows[0]?.profiles).toBeNull();
  });
  it.each(["list", "detail"])("loads %s without the removed direct profile FK and resolves the authorized assignee", async (mode) => {
    const { query, client, repository } = fixture();
    const row = mode === "list" ? (await repository.listWithRelations()).rows[0] : await repository.getWithRelations("project");
    expect(query.select.mock.calls[0]?.[0]).toBe("*, companies(id, name), services(id, name)");
    expect(client.rpc).toHaveBeenCalledWith("app_list_operational_assignees");
    expect(row?.profiles).toEqual({ id: "member", display_name: "Synthetic member", avatar_url: "/synthetic-avatar.png" });
  });
  it("normalizes an unassigned Project without requesting profile data", async () => {
    const { client, repository } = fixture(false);
    expect((await repository.listWithRelations()).rows[0]?.profiles).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("does not invent an assignee when the authorized projection refuses", async () => {
    const { client, repository } = fixture();
    client.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } } as never);
    await expect(repository.listWithRelations()).rejects.toThrow();
  });
});
