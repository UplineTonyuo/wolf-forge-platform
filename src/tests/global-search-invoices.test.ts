import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalSearchAction } from "../app/actions/global-search";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  filters: vi.fn(),
  billing: { view: true, manage: false },
  invoices: [{ id: "invoice-id", invoice_number: 12567 }],
}));

vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({
    actor: { id: "staff" },
    user: { tenantId: "tenant", invoices: mocks.billing },
    client: { from: mocks.from },
    services: { tickets: { list: async () => [] } },
  }),
}));
vi.mock("../lib/security/server-cost-limit", () => ({
  enforceServerCostLimit: async () => {},
}));

describe("global invoice search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.billing = { view: true, manage: false };
    mocks.invoices = [{ id: "invoice-id", invoice_number: 12567 }];
    mocks.from.mockImplementation((table: string) => {
      const chain = {
        select: () => chain,
        is: (column: string, value: null) => {
          mocks.filters(table, column, value);
          return chain;
        },
        ilike: () => chain,
        order: () => chain,
        gte: () => chain,
        lte: () => chain,
        eq: (column: string, value: string | number) => {
          mocks.filters(table, column, value);
          return chain;
        },
        filter: (column: string, operator: string, value: string) => {
          expect(operator).toBe("eq");
          mocks.filters(table, column, value);
          return chain;
        },
        limit: async () => ({ data: table === "invoices" ? mocks.invoices : [], error: null }),
      };
      return chain;
    });
  });

  it.each(["WF-12567", "wf-12567", "12567"])("opens the exact invoice for %s", async (query) => {
    expect(await globalSearchAction(query)).toMatchObject({
      ok: true,
      results: [{ kind: "invoice", title: "WF-12567", href: "/invoices/invoice-id" }],
    });
    expect(mocks.filters).toHaveBeenCalledWith("invoices", "invoice_number", 12567);
    expect(mocks.filters).toHaveBeenCalledWith("invoices", "tenant_id", "tenant");
    expect(mocks.filters).toHaveBeenCalledWith("invoices", "archived_at", null);
  });

  it("retains existing manage-only billing authority", async () => {
    mocks.billing = { view: false, manage: true };
    expect(await globalSearchAction("WF-12567")).toMatchObject({
      ok: true,
      results: [{ kind: "invoice" }],
    });
  });

  it("never queries invoices without billing authority", async () => {
    mocks.billing = { view: false, manage: false };
    expect(await globalSearchAction("WF-12567")).toEqual({ ok: true, results: [] });
    expect(mocks.from).not.toHaveBeenCalledWith("invoices");
  });

  it.each(["service title", "WF-12567%", "WF-12567_"])(
    "avoids a billing lookup for %s",
    async (query) => {
      expect(await globalSearchAction(query)).toEqual({ ok: true, results: [] });
      expect(mocks.from).not.toHaveBeenCalledWith("invoices");
    },
  );
});
