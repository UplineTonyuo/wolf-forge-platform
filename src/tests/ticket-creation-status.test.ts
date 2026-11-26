import { beforeEach, expect, it, vi } from "vitest";
import { checkInternalTicketCreation } from "../app/actions/tickets";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), trusted: vi.fn(), from: vi.fn(), select: vi.fn(),
  eq: vi.fn(), maybeSingle: vi.fn(), get: vi.fn(),
}));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: mocks.trusted }));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));

const request = "10000000-0000-4000-8000-000000000001";
const user = { tenantId: "tenant", modules: { tickets: true }, tickets: { view: true, create: true } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ actor: { id: "author" }, user, services: { tickets: { get: mocks.get } } });
  mocks.trusted.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue(mocks);
  mocks.eq.mockReturnValue(mocks);
});

it("checks the original ticket for this author and tenant and verifies ticket access", async () => {
  mocks.maybeSingle.mockResolvedValue({ data: { ticket_id: "original" }, error: null });
  expect(await checkInternalTicketCreation(request)).toEqual({ ok: true, ticketId: "original" });
  expect(mocks.from).toHaveBeenCalledWith("ticket_messages");
  expect(mocks.eq.mock.calls).toEqual([
    ["tickets.tenant_id", "tenant"], ["author_profile_id", "author"],
    ["message_kind", "initial_request"], ["request_id", request],
  ]);
  expect(mocks.get).toHaveBeenCalledWith("original");
  mocks.get.mockRejectedValue(new Error("denied"));
  expect(await checkInternalTicketCreation(request)).toMatchObject({ ok: false });
});

it("only reports absence after a successful read", async () => {
  mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "offline" } })
    .mockResolvedValueOnce({ data: null, error: null });
  expect(await checkInternalTicketCreation(request)).toMatchObject({ ok: false });
  expect(await checkInternalTicketCreation(request)).toEqual({ ok: true, ticketId: null });
});

it("requires a valid request and current ticket permissions before looking it up", async () => {
  expect(await checkInternalTicketCreation("invalid")).toMatchObject({ ok: false });
  mocks.context.mockResolvedValue({ user: { ...user, modules: { tickets: false } } });
  expect(await checkInternalTicketCreation(request)).toMatchObject({ ok: false });
  expect(mocks.trusted).not.toHaveBeenCalled();
});
