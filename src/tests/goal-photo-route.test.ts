import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError, RateLimitedError } from "../lib/errors/application-error";
import { GET, POST } from "../app/api/team-goals/[goalId]/photo/route";

const deps = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), get: vi.fn(), download: vi.fn(), store: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: deps.revalidate }));
vi.mock("../lib/supabase/next-server", () => ({ getVerifiedSessionContext: deps.session }));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: () => ({}) }));
vi.mock("../repositories/goal-repository", () => ({ GoalRepository: class { photoContext = deps.context; get = deps.get; } }));
vi.mock("../repositories/ticket-attachment-storage-repository", () => ({ TicketAttachmentStorageRepository: class { download = deps.download; storeOrConfirm = deps.store; } }));
vi.mock("../services/mutation-context", () => ({ requireVerifiedActor: () => undefined }));
const id = "a0000000-0000-4000-8000-000000000002";
const params = { params: Promise.resolve({ goalId: id }) };
const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const checksum = createHash("sha256").update(png).digest("hex");
const upload = (origin = "https://local.example") => new Request("https://local.example/api/team-goals/" + id + "/photo", { method: "POST", headers: { origin, host: "local.example" }, body: png });
beforeEach(() => {
  vi.resetAllMocks();
  deps.session.mockResolvedValue({ client: {}, actor: { id } });
  deps.context.mockResolvedValue({ photo_path: "private/image.png", photo_size: png.length, photo_mime: "image/png", photo_checksum: checksum });
  deps.get.mockResolvedValue({ photo_path: "private/image.png" });
  deps.download.mockResolvedValue(new Blob([png]));
});

describe("private Goal photo transport", () => {
  it("rejects cross-origin uploads before authentication or Storage", async () => {
    expect((await POST(upload("https://foreign.example"), params)).status).toBe(403);
    expect(deps.session).not.toHaveBeenCalled(); expect(deps.store).not.toHaveBeenCalled();
  });
  it("requires a session before any photo lookup", async () => {
    deps.session.mockResolvedValue(null);
    expect((await GET(new Request("https://local.example"), params)).status).toBe(401);
    expect(deps.context).not.toHaveBeenCalled();
  });
  it.each([[new PermissionDeniedError(),403],[new RateLimitedError(),429]])("denies upload admission before buffering or Storage", async (error,status) => {
    deps.context.mockRejectedValue(error);
    const request=upload(),read=vi.spyOn(request.body!,"getReader");
    expect((await POST(request,params)).status).toBe(status);
    expect(read).not.toHaveBeenCalled(); expect(deps.store).not.toHaveBeenCalled();
  });
  it("rechecks access after download and never returns bytes after access is revoked", async () => {
    deps.get.mockRejectedValue(new PermissionDeniedError());
    const response=await GET(new Request("https://local.example"),params);
    expect(response.status).toBe(403); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("refuses a corrupted photo instead of rendering unverified content", async () => {
    deps.download.mockResolvedValue(new Blob([new Uint8Array([1,2,3])]));
    expect((await GET(new Request("https://local.example"),params)).status).toBe(400);
  });
  it("serves verified bytes privately without a reusable signed URL", async () => {
    const response=await GET(new Request("https://local.example"),params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });
});
