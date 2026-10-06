import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInternalContext: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.getInternalContext }));

const { addCompanyPersonAction, updateCompanyAction } = await import("../app/actions/companies");

const actor = { id: "actor-1" };
const companyId = "20000000-0000-4000-8000-000000000002";
const contactId = "30000000-0000-4000-8000-000000000003";

function context(options?: { create?: boolean; edit?: boolean; privateManage?: boolean }) {
  const addMember = vi.fn().mockResolvedValue(undefined);
  const organizationUpdate = vi.fn().mockResolvedValue({ id: companyId });
  const clientCompanies = { create: vi.fn(), update: vi.fn() };
  const contacts = { create: vi.fn() };
  mocks.getInternalContext.mockResolvedValue({
    actor,
    user: { clients: { create: options?.create ?? true, edit: options?.edit ?? true, privateManage: options?.privateManage ?? true } },
    services: {
      permissions: { requireModuleAccess: vi.fn().mockResolvedValue(undefined) },
      organizations: { update: organizationUpdate, addMember },
      companies: clientCompanies,
      contacts,
    },
  });
  return { addMember, organizationUpdate, clientCompanies, contacts };
}

beforeEach(() => {
  mocks.getInternalContext.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("Company mutations", () => {
  it("adds an existing person through explicit membership without touching Client records", async () => {
    const spies = context();
    await expect(addCompanyPersonAction(companyId, contactId)).resolves.toEqual({ ok: true });

    expect(spies.addMember).toHaveBeenCalledWith(companyId, contactId, actor);
    expect(spies.contacts.create).not.toHaveBeenCalled();
    expect(spies.clientCompanies.create).not.toHaveBeenCalled();
    expect(spies.clientCompanies.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/clients");
  });

  it("blocks unauthorized membership changes before mutation", async () => {
    const denied = context({ privateManage: false });
    await expect(addCompanyPersonAction(companyId, contactId))
      .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/permission/u) });
    expect(denied.addMember).not.toHaveBeenCalled();
  });

  it("renames the Company entity, never the Client record", async () => {
    const spies = context();
    await expect(updateCompanyAction(companyId, "Renamed")).resolves.toEqual({ ok: true });
    expect(spies.organizationUpdate).toHaveBeenCalledWith(companyId, "Renamed", actor);
    expect(spies.clientCompanies.update).not.toHaveBeenCalled();
  });

  it("requires edit capability for Company identity changes", async () => {
    const spies = context({ edit: false });
    await expect(updateCompanyAction(companyId, "Renamed")).resolves.toMatchObject({ ok: false });
    expect(spies.organizationUpdate).not.toHaveBeenCalled();
  });
});
