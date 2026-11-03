import { describe, expect, it, vi } from "vitest";
import { readPublicInvoiceShare } from "../repositories/public-invoice-share-repository";

describe("public invoice read boundary", () => {
  it("calls only the capability projection and preserves current denial", async () => {
    const rpc = vi.fn().mockResolvedValue({data:null,error:{code:"42501",message:"denied"}});
    await expect(readPublicInvoiceShare({rpc} as never,"ab".repeat(32))).rejects.toThrow();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_get_public_invoice_share",{p_token:"ab".repeat(32)});
  });
  it("refuses malformed capability input before accessing the database", async () => {
    const rpc = vi.fn();
    await expect(readPublicInvoiceShare({rpc} as never,"invalid")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a malformed successful projection", async () => {
    const rpc = vi.fn().mockResolvedValue({data:{invoice:{status:"paid"}},error:null});
    await expect(readPublicInvoiceShare({rpc} as never,"ab".repeat(32))).rejects.toThrow();
  });
});
