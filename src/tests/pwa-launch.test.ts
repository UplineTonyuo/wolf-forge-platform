import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as launch } from "../app/launch/route";
import { IdentityLookupError } from "../lib/supabase/identity-lookup";

const auth = vi.hoisted(() => ({ session: vi.fn(), internal: vi.fn(), client: vi.fn(), failure: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({
  getVerifiedSessionContext: auth.session, resolveInternalUser: auth.internal, resolveClientUser: auth.client,
}));
vi.mock("../lib/supabase/identity-failure-response", () => ({ identityFailureResponse: auth.failure }));
const context = { actor: { id: "verified-actor" }, client: {} };
const GET: (request: Request) => Promise<Response> = launch;
const request = new Request("https://workspace.example/launch?next=https://foreign.example");

beforeEach(() => {
  vi.resetAllMocks();
  auth.session.mockResolvedValue(context);
  auth.internal.mockResolvedValue(null);
  auth.client.mockResolvedValue(null);
  auth.failure.mockResolvedValue(new Response(null, { status: 403 }));
});

describe("installed app launch", () => {
  it("keeps the browser origin when the server request URL has a normalized hostname", async () => {
    auth.session.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost:3045/launch?next=https://foreign.example", {
      headers: { host: "127.0.0.1:3045", "x-forwarded-host": "foreign.example" },
    }));
    const destination = new URL(response.headers.get("location")!, "http://127.0.0.1:3045/launch");
    expect(destination.href).toBe("http://127.0.0.1:3045/login");
  });

  it("sends a missing session to normal login without resolving a role", async () => {
    auth.session.mockResolvedValue(null);
    const response = await GET(request);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(auth.internal).not.toHaveBeenCalled();
    expect(auth.client).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin", "manager", "staff"])("preserves the existing home routing for %s", async (role) => {
    auth.internal.mockResolvedValue({ role });
    const response = await GET(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/");
    expect(auth.internal).toHaveBeenCalledWith(context.client, context.actor);
    expect(auth.client).not.toHaveBeenCalled();
  });

  it("launches a client in the client portal using existing verified resolvers", async () => {
    auth.client.mockResolvedValue({ companyId: "synthetic-company" });
    expect((await GET(request)).headers.get("location")).toBe("/account");
    expect(auth.client).toHaveBeenCalledWith(context.client, context.actor);
  });

  it("does not grant an unassigned account a workspace", async () => {
    expect((await GET(request)).headers.get("location")).toBe("/login");
  });

  it("keeps unavailable identity distinct from a missing session", async () => {
    auth.session.mockRejectedValue(new IdentityLookupError("unavailable", "claims"));
    expect((await GET(request)).headers.get("location")).toBe("/login?reason=identity-unavailable");
    expect(auth.internal).not.toHaveBeenCalled();
  });

  it.each(["unauthenticated", "unauthorized"] as const)("delegates %s to the canonical Auth mapper", async (kind) => {
    const error = new IdentityLookupError(kind, "claims");
    auth.session.mockRejectedValue(error);
    expect((await GET(request)).status).toBe(403);
    expect(auth.failure).toHaveBeenCalledWith(error);
  });
});
