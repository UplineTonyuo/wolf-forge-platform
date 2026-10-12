import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import { FormRepository } from "../repositories/form-repository";
import { WHITE_LABEL_DRAFT_GUIDANCE } from "../domain/white-label/preview";
import { formsAccessChanged } from "../domain/forms/visibility";

describe("integrated Forms boundaries", () => {
  it("redacts lost Project scope even when assignment identity and permissions stay the same", () => {
    const before = JSON.stringify({ authority: ["actor", true], recordIds: ["assignment:same", "assignment:same:project:visible"] });
    const after = JSON.stringify({ authority: ["actor", true], recordIds: ["assignment:same"] });
    expect(formsAccessChanged(before, after)).toBe(true);
  });
  it("lists submissions through the scoped projection RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "receipt", order_id: null }], error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await expect(new FormRepository(client).listSubmissions("form", "order")).resolves.toEqual([{ id: "receipt", order_id: null }]);
    expect(rpc).toHaveBeenCalledWith("app_list_form_submissions", { p_form_id: "form", p_order_id: "order" });
  });

  it("explains Forms optionality and retained history without changing Invoice guidance", () => {
    expect(WHITE_LABEL_DRAFT_GUIDANCE).toContain("Invoices and Forms are optional for publication; Services and Coupons are required");
    expect(WHITE_LABEL_DRAFT_GUIDANCE).toContain("currently authorized history");
    expect(WHITE_LABEL_DRAFT_GUIDANCE).toContain("no outstanding or pending financial obligations");
  });
});
