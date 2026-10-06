import { describe, expect, it, beforeEach, vi } from "vitest";
import { PermissionDeniedError } from "../lib/errors/application-error";

const getInternalContext = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { url });
});

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: () => getInternalContext(),
}));

const { createCompanyAction } = await import("../app/actions/clients");

const requestId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const actor = { id: "33333333-3333-4333-8333-333333333333" };
const company = {
  id: companyId,
  name: "QA Local Company Alpha",
  status: "contact",
  stripe_customer_id: null,
  created_at: "2026-10-06T00:00:00.000Z",
  updated_at: "2026-10-06T00:00:00.000Z",
  archived_at: null,
};

function formData(name: string, id = requestId) {
  const data = new FormData();
  data.set("request_id", id);
  data.set("name", name);
  return data;
}

function context(options?: {
  canCreate?: boolean;
  companies?: typeof company[];
  clientRecords?: Array<{ id: string; name: string }>;
  moduleError?: Error;
  readbackError?: Error;
}) {
  const create = vi.fn().mockResolvedValue(company);
  const get = options?.readbackError
    ? vi.fn().mockRejectedValue(options.readbackError)
    : vi.fn().mockResolvedValue(company);
  const contactsCreate = vi.fn();
  const provisionClientAccount = vi.fn();
  const createAuthUser = vi.fn();
  const clientRecords = {
    listActive: vi.fn().mockResolvedValue(options?.clientRecords ?? []),
    create: vi.fn(),
  };
  const requireModuleAccess = options?.moduleError
    ? vi.fn().mockRejectedValue(options.moduleError)
    : vi.fn().mockResolvedValue(undefined);

  getInternalContext.mockResolvedValue({
    actor,
    user: { clients: { create: options?.canCreate ?? true } },
    services: {
      permissions: { requireModuleAccess },
      // Company / Team entities, separate from Client records in `companies`.
      organizations: {
        listActive: vi.fn().mockResolvedValue(options?.companies ?? []),
        create,
        get,
      },
      companies: clientRecords,
      contacts: { create: contactsCreate },
      accountProvisioning: { provisionClientAccount },
    },
    authAdmin: { createUser: createAuthUser },
  });

  return {
    create,
    get,
    clientRecords,
    contactsCreate,
    provisionClientAccount,
    createAuthUser,
    requireModuleAccess,
  };
}

beforeEach(() => {
  getInternalContext.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe("createCompanyAction", () => {
  it("creates and freshly reads a company, then redirects to its canonical detail route", async () => {
    const spies = context();

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData("  QA Local Company Alpha  "),
      ),
    ).rejects.toMatchObject({ url: `/companies/${companyId}?created=1` });

    expect(spies.requireModuleAccess).toHaveBeenCalledWith("clients");
    expect(spies.create).toHaveBeenCalledWith(
      { request_id: requestId, name: "QA Local Company Alpha" },
      actor,
    );
    expect(spies.get).toHaveBeenCalledWith(companyId);
    expect(revalidatePath.mock.calls).toEqual([
      ["/companies"],
      [`/companies/${companyId}`],
    ]);
    expect(spies.clientRecords.create).not.toHaveBeenCalled();
    expect(spies.contactsCreate).not.toHaveBeenCalled();
    expect(spies.provisionClientAccount).not.toHaveBeenCalled();
    expect(spies.createAuthUser).not.toHaveBeenCalled();
  });

  it.each(["", "   \t\n  "])("rejects a blank company name: %j", async (name) => {
    const spies = context();

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData(name),
      ),
    ).resolves.toMatchObject({ fieldError: "Enter a company name." });
    expect(spies.create).not.toHaveBeenCalled();
  });

  it("rejects a company name over 200 characters", async () => {
    const spies = context();

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData("a".repeat(201)),
      ),
    ).resolves.toMatchObject({
      fieldError: "Company name must be 200 characters or fewer.",
    });
    expect(spies.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid request id before mutation", async () => {
    const spies = context();

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData("Valid Company", "not-a-uuid"),
      ),
    ).resolves.toMatchObject({ error: "Refresh the page and try again." });
    expect(spies.create).not.toHaveBeenCalled();
  });

  it("rejects a caller without clients.create", async () => {
    const spies = context({ canCreate: false });

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData("Denied Company"),
      ),
    ).resolves.toMatchObject({
      error: "You do not have permission to create Companies.",
    });
    expect(spies.create).not.toHaveBeenCalled();
  });

  it("rejects a caller denied the Clients module", async () => {
    const spies = context({ moduleError: new PermissionDeniedError() });

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData("Denied Company"),
      ),
    ).resolves.toMatchObject({
      error: "You do not have permission to perform this operation.",
    });
    expect(spies.create).not.toHaveBeenCalled();
  });

  it("blocks a normalized exact-name duplicate and identifies the existing company", async () => {
    const existing = { ...company, name: "Café   Wolf Forge" };
    const spies = context({ companies: [existing] });

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData(" cafe wolf forge "),
      ),
    ).resolves.toEqual({
      error: null,
      fieldError: null,
      duplicate: { id: companyId, name: existing.name },
    });
    expect(spies.create).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not treat a Client business name as an existing Company", async () => {
    const spies = context({ clientRecords: [{ id: "client-1", name: "Anthony PLATFORM" }] });

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData("Anthony PLATFORM"),
      ),
    ).rejects.toMatchObject({ url: `/companies/${companyId}?created=1` });
    expect(spies.clientRecords.listActive).not.toHaveBeenCalled();
    expect(spies.create).toHaveBeenCalledOnce();
  });

  it("does not claim success when fresh readback fails", async () => {
    const spies = context({ readbackError: new Error("readback failed") });

    await expect(
      createCompanyAction(
        { error: null, fieldError: null, duplicate: null },
        formData("QA Local Company Alpha"),
      ),
    ).resolves.toMatchObject({ error: "The operation failed." });
    expect(spies.create).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });
});
