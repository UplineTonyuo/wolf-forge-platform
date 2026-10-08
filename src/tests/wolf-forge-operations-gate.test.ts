import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * WL-2.22a (D-285). Operations department data is one Wolf Forge Google Sheet
 * integration behind a cache shared by every request. An internal member of
 * any other Tenant must be refused BEFORE a loader runs, a Sheets fetch is made
 * or the cache is read. `user.tenantId` stands in for the database-validated
 * current Tenant returned by app_current_tenant_membership (pgTAP 119).
 */

const WF = "f0f0f0f0-0000-4000-8000-000000000001";
const TENANT_B = "f0f0f0f0-0000-4000-8000-000000002201";

const loaders = vi.hoisted(() => ({
  podcast: vi.fn(async () => null),
  content: vi.fn(async () => ({ state: "unavailable" })),
  gmb: vi.fn(async () => ({ state: "unavailable" })),
  offPage: vi.fn(async () => ({ state: "unavailable" })),
  onPage: vi.fn(async () => ({ state: "unavailable" })),
  technical: vi.fn(async () => ({ state: "unavailable" })),
  website: vi.fn(async () => ({ state: "unavailable" })),
  youtube: vi.fn(async () => ({ state: "unavailable" })),
  cacheRead: vi.fn(async () => "cached-version"),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: () => loaders.cacheRead,
  revalidateTag: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: vi.fn(),
  getInternalActorContext: vi.fn(),
}));
vi.mock("../services/podcast-workflow-service", () => ({
  loadPodcastWorkflowSnapshotBundleOrNull: loaders.podcast,
}));
vi.mock("../services/content-workflow-service", () => ({ loadContentWorkflow: loaders.content }));
vi.mock("../services/gmb-management-workflow-service", () => ({ loadGmbManagementWorkflow: loaders.gmb }));
vi.mock("../services/off-page-seo-workflow-service", () => ({ loadOffPageSeoWorkflow: loaders.offPage }));
vi.mock("../services/on-page-seo-workflow-service", () => ({ loadOnPageSeoWorkflow: loaders.onPage }));
vi.mock("../services/technical-seo-workflow-service", () => ({ loadTechnicalSeoWorkflow: loaders.technical }));
vi.mock("../services/website-builder-workflow-service", () => ({ loadWebsiteBuilderWorkflow: loaders.website }));
vi.mock("../services/youtube-seo-workflow-service", () => ({ loadYoutubeSeoWorkflow: loaders.youtube }));

const fetchSpy = vi.fn(async () => new Response("{}"));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function asTenant(tenantId: string | null) {
  const nextServer = await import("../lib/supabase/next-server");
  const context = tenantId === null ? null : { actor: { id: "x" }, user: { tenantId } };
  vi.mocked(nextServer.getInternalActorContext).mockResolvedValue(context as never);
  vi.mocked(nextServer.getInternalContext).mockResolvedValue(context as never);
}

const pages = [
  ["podcast-seo", "podcast"],
  ["content", "content"],
  ["gmb-management", "gmb"],
  ["off-page-seo", "offPage"],
  ["on-page-seo", "onPage"],
  ["technical-seo", "technical"],
  ["website-builder", "website"],
  ["youtube-seo", "youtube"],
] as const;

async function renderPage(route: string) {
  const page = (await import(`../app/(internal)/todo/departments/${route}/page.tsx`)).default as (
    props: { searchParams: Promise<Record<string, string>> },
  ) => Promise<unknown>;
  return page({ searchParams: Promise.resolve({}) });
}

describe("Operations department pages are Wolf Forge-only", () => {
  it.each(pages)("%s: a Tenant B internal member gets 404 before the loader runs", async (route, loader) => {
    await asTenant(TENANT_B);
    await expect(renderPage(route)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loaders[loader]).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(pages)("%s: a Wolf Forge internal member still loads the workflow", async (route, loader) => {
    await asTenant(WF);
    await renderPage(route);
    expect(loaders[loader]).toHaveBeenCalledTimes(1);
  });

  it("a missing or non-UUID Tenant fails closed", async () => {
    for (const tenantId of ["", "F0F0F0F0-0000-4000-8000-000000000001", "wolf-forge"]) {
      await asTenant(tenantId);
      await expect(renderPage("podcast-seo")).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(loaders.podcast).not.toHaveBeenCalled();
  });
});

describe("Operations API routes are Wolf Forge-only", () => {
  it("snapshot: Tenant B gets 404 with no loader call or Sheets fetch", async () => {
    await asTenant(TENANT_B);
    const { GET } = await import("../app/api/operations/podcast-seo/snapshot/route");
    const response = await GET(new Request("http://localhost/api/operations/podcast-seo/snapshot?month=2026-07"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ ok: false, error: "Not found." });
    expect(loaders.podcast).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("version: Tenant B gets 404 with no cache read", async () => {
    await asTenant(TENANT_B);
    const { GET } = await import("../app/api/operations/podcast-seo/version/route");
    const response = await GET();
    expect(response.status).toBe(404);
    expect(loaders.cacheRead).not.toHaveBeenCalled();
  });

  it("no session: 401 with no loader call or cache read", async () => {
    await asTenant(null);
    const snapshot = await import("../app/api/operations/podcast-seo/snapshot/route");
    const version = await import("../app/api/operations/podcast-seo/version/route");
    expect((await snapshot.GET(new Request("http://localhost/api/operations/podcast-seo/snapshot"))).status).toBe(401);
    expect((await version.GET()).status).toBe(401);
    expect(loaders.podcast).not.toHaveBeenCalled();
    expect(loaders.cacheRead).not.toHaveBeenCalled();
  });

  it("Wolf Forge: both routes keep working", async () => {
    await asTenant(WF);
    const snapshot = await import("../app/api/operations/podcast-seo/snapshot/route");
    const version = await import("../app/api/operations/podcast-seo/version/route");
    expect((await snapshot.GET(new Request("http://localhost/api/operations/podcast-seo/snapshot"))).status).toBe(200);
    const versionResponse = await version.GET();
    expect(versionResponse.status).toBe(200);
    expect(await versionResponse.json()).toEqual({ ok: true, version: "cached-version" });
    expect(loaders.podcast).toHaveBeenCalledTimes(1);
    expect(loaders.cacheRead).toHaveBeenCalledTimes(1);
  });
});

describe("No Operations data entry point skips the Wolf Forge gate", () => {
  const src = resolve(import.meta.dirname, "..");
  const departments = join(src, "app/(internal)/todo/departments");
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
    );

  it("every department page is covered above and awaits the gate", () => {
    const routes = readdirSync(departments, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(routes).toEqual(pages.map(([route]) => route).sort());
    for (const route of routes) {
      const page = readFileSync(join(departments, route, "page.tsx"), "utf8");
      expect(page).toContain("await requireWolfForgeOperations();");
      expect(page).not.toContain("getInternalContext");
    }
  });

  it("only gated pages and routes import the Operations data loaders", () => {
    const loaderImport = /from "[^"]*(?:workflow-service|workflow-source|google-sheets-source|operations-google-sheets|podcast-sync-version)"/;
    const importers = sourceFiles(join(src, "app"))
      .filter((file) => loaderImport.test(readFileSync(file, "utf8")))
      .map((file) => relative(src, file).replaceAll("\\", "/"))
      .sort();
    expect(importers).toEqual([
      ...pages.map(([route]) => `app/(internal)/todo/departments/${route}/page.tsx`),
      "app/api/operations/podcast-seo/snapshot/route.ts",
      "app/api/operations/podcast-seo/sync/route.ts",
      "app/api/operations/podcast-seo/version/route.ts",
    ].sort());
  });
});
