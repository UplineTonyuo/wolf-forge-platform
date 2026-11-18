import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalSearchAction } from "../app/actions/global-search";
import { matchesProjectSearch, type ProjectListRow } from "../domain/orders/projections";

const { from, limit, exact } = vi.hoisted(() => ({
  from: vi.fn(),
  limit: vi.fn(),
  exact: vi.fn(),
}));

vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({
    actor: { id: "synthetic-owner" },
    client: { from },
    services: { tickets: { list: async () => [] } },
  }),
}));
vi.mock("../lib/security/server-cost-limit", () => ({
  enforceServerCostLimit: async () => {},
}));

describe("original SPP order references", () => {
  beforeEach(() => {
    from.mockReset();
    limit.mockReset().mockResolvedValue({ data: [], error: null });
    exact.mockReset();
    from.mockImplementation(() => {
      const chain = {
        select: () => chain,
        is: () => chain,
        ilike: () => chain,
        order: () => chain,
        eq: (column: string, value: string) => {
          if (column !== "spp_order_reference") return chain;
          exact(column, value);
          return {
            limit: async () => ({
              data: value === "ABCD5678_2" ? [{
                id: "imported-order",
                order_number: 25,
                spp_order_reference: value,
                title: "Renamed order",
                company_id: "company",
                service_id: "service",
                companies: null,
                services: null,
              }] : [],
              error: null,
            }),
          };
        },
        limit,
      };
      return chain;
    });
  });

  it.each(["ABCD5678_2", "#abcd5678_2", "# #ABCD5678_2"])(
    "finds the exact imported reference for %s and shows it as the number",
    async (query) => {
      const result = await globalSearchAction(query);
      expect(exact).toHaveBeenCalledWith("spp_order_reference", "ABCD5678_2");
      expect(result).toMatchObject({
        ok: true,
        results: [{
          id: "imported-order",
          href: "/orders/imported-order",
          subtitle: "Project #ABCD5678_2",
        }],
      });
    },
  );

  it("finds both full source and existing native numbers in the Orders list", () => {
    const row = {
      title: "Renamed order",
      orderNumber: 25,
      sppOrderReference: "ABCD5678_2",
      companyName: "Synthetic company",
      serviceName: "Synthetic service",
    } as ProjectListRow;
    expect(matchesProjectSearch(row, "# #abcd5678_2")).toBe(true);
    expect(matchesProjectSearch(row, "#25")).toBe(true);
    expect(matchesProjectSearch(row, "ABCD5678_3")).toBe(false);
    expect(matchesProjectSearch({
      ...row,
      title: "Historical order [SPP #ABCD5678_20]",
      sppOrderReference: "ABCD5678_20",
    }, "ABCD5678_2")).toBe(false);
  });
});
