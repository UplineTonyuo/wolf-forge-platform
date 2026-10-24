import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, PermissionDeniedError, ValidationError } from "../lib/errors/application-error";

/**
 * Regression coverage for the secure image/file delivery fix: this route
 * used to `Response.redirect()` the browser straight to a raw Supabase
 * Storage signed URL (rewritten host and all) — the browser could see, copy,
 * and reuse the token. It must now proxy the bytes itself, with the raw
 * Storage host/token never reaching a response header or body. Every
 * authorization decision (attachment/scan status, Ticket access, Order
 * access, internal-note-vs-client visibility) already happens inside
 * `TicketService.attachmentDownload` / `app_get_ticket_attachment_download`
 * (see `067_order_message_actions.test.sql` and
 * `069_project_conversation_attachments.test.sql` for the RPC-level
 * authorization matrix) — this test only proves the route turns each
 * outcome into the right HTTP response and never leaks the signed URL.
 */

const attachmentDownloadMock = vi.fn();
const storageDownloadMock = vi.fn();

vi.mock("../lib/security/server-cost-limit", () => ({ enforceServerCostLimit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../lib/supabase/next-server", () => ({
  getSelfServiceContext: vi.fn(async () => ({ actor: { profileId: "actor-1" }, client: {} })),
}));
vi.mock("../lib/env/server-env", () => ({
  readServerEnvironment: vi.fn(() => ({
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "secret",
  })),
}));
vi.mock("../lib/supabase/trusted-server-client", () => ({
  createTrustedServerSupabaseClient: vi.fn(() => ({})),
}));
// Constructor mocks must use a real `function`, not an arrow — `new` on an
// arrow-function implementation throws "is not a constructor".
vi.mock("../repositories/ticket-repository", () => ({
  TicketRepository: vi.fn().mockImplementation(function TicketRepository() {
    return {};
  }),
}));
vi.mock("../services/ticket-service", () => ({
  TicketService: vi.fn().mockImplementation(function TicketService() {
    return { attachmentDownload: attachmentDownloadMock };
  }),
}));
vi.mock("../repositories/ticket-attachment-storage-repository", () => ({
  TicketAttachmentStorageRepository: vi.fn().mockImplementation(function TicketAttachmentStorageRepository() {
    return { download: storageDownloadMock };
  }),
}));

const { GET } = await import("../app/api/ticket-attachments/[attachmentId]/route");

function callGet(attachmentId = "att-1") {
  return GET(new Request(`http://localhost/api/ticket-attachments/${attachmentId}`), {
    params: Promise.resolve({ attachmentId }),
  });
}

describe("GET /api/ticket-attachments/[attachmentId] — secure delivery", () => {
  beforeEach(() => {
    attachmentDownloadMock.mockReset();
    storageDownloadMock.mockReset();
  });

  it("authorized: streams the object's bytes with 200 and safe headers, never a redirect", async () => {
    attachmentDownloadMock.mockResolvedValue({
      storage_object_key: "actor-1/att-1",
      mime_type: "image/png",
      original_name: "screenshot.png",
    });
    storageDownloadMock.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }));

    const response = await callGet();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(response.headers.get("Content-Disposition")).toContain("screenshot.png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");

    // The browser must never receive a raw Supabase Storage URL or token —
    // not as a redirect, and not embedded anywhere in the response.
    expect(response.headers.get("Location")).toBeNull();
    for (const [key, value] of response.headers.entries()) {
      expect(value.toLowerCase(), `header ${key}`).not.toContain("supabase");
      expect(value.toLowerCase(), `header ${key}`).not.toContain("/storage/v1/object/sign");
      expect(value.toLowerCase(), `header ${key}`).not.toContain("token=");
    }

    const body = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(body)).toEqual([1, 2, 3, 4]);
  });

  it("authorized non-image file: still inline, correct MIME, filename preserved", async () => {
    attachmentDownloadMock.mockResolvedValue({
      storage_object_key: "actor-1/att-2",
      mime_type: "application/pdf",
      original_name: "invoice.pdf",
    });
    storageDownloadMock.mockResolvedValue(new Blob([new Uint8Array([9])], { type: "application/pdf" }));

    const response = await callGet("att-2");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(response.headers.get("Content-Disposition")).toContain("invoice.pdf");
  });

  it("unrelated employee/client (PermissionDeniedError from the RPC boundary) maps to 403, bytes never fetched", async () => {
    attachmentDownloadMock.mockRejectedValue(new PermissionDeniedError());

    const response = await callGet();

    expect(response.status).toBe(403);
    expect(storageDownloadMock).not.toHaveBeenCalled();
  });

  it("not found / anti-enumeration disguise (internal-note leak guard, cross-company Order boundary) maps to 404, bytes never fetched", async () => {
    attachmentDownloadMock.mockRejectedValue(new NotFoundError("Ticket attachment"));

    const response = await callGet();

    expect(response.status).toBe(404);
    expect(storageDownloadMock).not.toHaveBeenCalled();
  });

  it("any other application error maps to 400, never a redirect", async () => {
    attachmentDownloadMock.mockRejectedValue(new ValidationError("bad id"));

    const response = await callGet();

    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
  });
});
