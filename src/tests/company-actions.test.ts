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

function context(options?: { create?: boolean; edit?: boolean; privateManage?: boolean; contacts?: Array<{ email: string | null }> }) {
  const contactsCreate = vi.fn().mockResolvedValue({ id: "contact-1" });
  const companyUpdate = vi.fn().mockResolvedValue({ id: companyId });
  mocks.getInternalContext.mockResolvedValue({
    actor,
    user: { clients: { create: options?.create ?? true, edit: options?.edit ?? true, privateManage: options?.privateManage ?? true } },
    services: {
      permissions: { requireModuleAccess: vi.fn().mockResolvedValue(undefined) },
      companies: { update: companyUpdate },
      contacts: {
        listForCompany: vi.fn().mockResolvedValue(options?.contacts ?? []),
        create: contactsCreate,
      },
    },
  });
  return { contactsCreate, companyUpdate };
}

beforeEach(() => {
  mocks.getInternalContext.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("Company mutations", () => {
  it("creates the first person as primary without creating portal access", async () => {
    const spies = context();
    await expect(addCompanyPersonAction(companyId, {
      requestId: "30000000-0000-4000-8000-000000000003",
      name: "Jane Doe",
      email: "Jane@Example.test",
      phone: "",
      jobTitle: "",
    })).resolves.toEqual({ ok: true });

    expect(spies.contactsCreate).toHaveBeenCalledWith(expect.objectContaining({
      company_id: companyId,
      email: "jane@example.test",
      is_primary: true,
    }), actor);
    expect(spies.contactsCreate.mock.calls[0]?.[0]).not.toHaveProperty("profile_id");
  });

  it("blocks duplicate email and unauthorized contact access before mutation", async () => {
    const duplicate = context({ contacts: [{ email: "jane@example.test" }] });
    await expect(addCompanyPersonAction(companyId, {
      requestId: "30000000-0000-4000-8000-000000000003",
      name: "Jane Again",
      email: " JANE@example.test ",
      phone: "",
      jobTitle: "",
    })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/already linked/u) });
    expect(duplicate.contactsCreate).not.toHaveBeenCalled();

    const denied = context({ privateManage: false });
    await expect(addCompanyPersonAction(companyId, {
      requestId: "30000000-0000-4000-8000-000000000003",
      name: "Denied",
      email: "",
      phone: "",
      jobTitle: "",
    })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/permission/u) });
    expect(denied.contactsCreate).not.toHaveBeenCalled();
  });

  it("requires edit capability for Company identity changes", async () => {
    const spies = context({ edit: false });
    await expect(updateCompanyAction(companyId, "Renamed")).resolves.toMatchObject({ ok: false });
    expect(spies.companyUpdate).not.toHaveBeenCalled();
  });
});
