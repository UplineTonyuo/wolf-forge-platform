import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/form-submissions/[submissionId]/pdf/route";
import { receiptFixture } from "./fixtures/form-pdf-fixture";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), render: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getVerifiedSessionContext: mocks.session }));
vi.mock("../lib/forms/render-submission-pdf", () => ({ renderSubmissionPdf: mocks.render }));
const id = "20000000-0000-4000-8000-000000000001";
const request = () => new Request(`http://localhost/api/form-submissions/${id}/pdf`);
const params = (submissionId = id) => ({ params: Promise.resolve({ submissionId }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue({ actor: { id }, client: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ error: null, data: receiptFixture() }); mocks.render.mockResolvedValue(new TextEncoder().encode("%PDF-1.7 synthetic"));
});
describe("authenticated saved-form PDF route", () => {
  it("uses the caller's scoped RPC and sends a private PDF attachment", async () => {
    const response = await GET(request(), params());
    expect(mocks.rpc).toHaveBeenCalledWith("app_get_form_submission_pdf", { p_submission_id: id, p_include_project: true });
    expect(response.status).toBe(200);expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("content-disposition")).toContain(`form-submission-${id}.pdf`);
    expect(await response.text()).toMatch(/^%PDF/);
  });
  it("returns an explicit 401 instead of redirecting to login", async () => {
    mocks.session.mockResolvedValue(null);const response = await GET(request(), params());
    expect(response.status).toBe(401);expect(response.headers.get("location")).toBeNull();expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.render).not.toHaveBeenCalled();
  });
  it("rejects malformed identifiers without database or PDF work", async () => {
    expect((await GET(request(), params("../private"))).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["42501", "P0002"])("does not disclose another actor's record when SQL refuses with %s", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private details" } });
    const response = await GET(request(), params());expect(response.status).toBe(404);expect(await response.text()).not.toContain("private details");expect(mocks.render).not.toHaveBeenCalled();
  });
  it("honors the durable quota before font or PDF work", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "WF429" } });const response = await GET(request(), params());
    expect(response.status).toBe(429);expect(response.headers.get("retry-after")).toBe("60");expect(mocks.render).not.toHaveBeenCalled();
  });
  it("fails closed on oversized or malformed receipt data", async () => {
    const receipt = receiptFixture();receipt.form.information_html = "x".repeat(350_001);mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect((await GET(request(), params())).status).toBe(503);expect(mocks.render).not.toHaveBeenCalled();
  });
  it("keeps saved submission intact when generation fails", async () => {
    mocks.render.mockRejectedValue(new Error("internal font path"));const response = await GET(request(), params());
    expect(response.status).toBe(503);expect(await response.text()).toContain("saved form is unchanged");expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});

describe("archived signed agreement download", () => {
  const signedRequest = () => new Request(request().url + "?original=signed");
  const original = Buffer.from("%PDF-1.7\nsynthetic signature evidence\n%%EOF");
  const archive = {
    original_name: "Original agreement.pdf",
    contents_base64: original.toString("base64"),
    sha256_hex: createHash("sha256").update(original).digest("hex"),
    size_bytes: original.length,
  };
  it("returns the verified original bytes through the caller's scoped RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: archive, error: null });
    const response = await GET(signedRequest(), params());
    expect(mocks.rpc).toHaveBeenCalledWith("app_get_spp_signed_agreement", { p_submission_id: id });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("Original%20agreement.pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("rejects altered signed bytes without rendering a substitute", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...archive, sha256_hex: "0".repeat(64) }, error: null });
    expect((await GET(signedRequest(), params())).status).toBe(503);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
