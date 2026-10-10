import { describe, expect, it, vi } from "vitest";
import { OrderRepository } from "../repositories/order-repository";

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
