import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import type { FormPublishedSchema, SubmitFormInput } from "../domain/forms/schema";
import { NotFoundError } from "../lib/errors/application-error";

const state = vi.hoisted(() => ({
  rpc: vi.fn(), userRpc: vi.fn(), tenant: vi.fn(), trusted: vi.fn(), nextClient: vi.fn(),
  context: vi.fn(), publish: vi.fn(), archive: vi.fn(), bot: vi.fn(), updateTag: vi.fn(),
}));
vi.mock("next/cache", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.assign(globalThis, { AsyncLocalStorage });
  const actual = await vi.importActual<typeof import("next/cache")>("next/cache");
  return { ...actual, updateTag: state.updateTag, revalidatePath: vi.fn() };
});
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: () => { throw new Error("NEXT_REDIRECT"); },
}));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: vi.fn(() => ({})) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({ createTrustedServerSupabaseClient: state.trusted }));
vi.mock("../lib/supabase/next-server", () => ({
  requestTenantSelector: state.tenant, createNextServerSupabaseClient: state.nextClient,
  getInternalContext: state.context, getClientContext: vi.fn(),
}));
vi.mock("botid/server", () => ({ checkBotId: state.bot }));
vi.mock("../lib/security/observed-failure", async () => {
  const { toClientSafeError } = await import("../lib/errors/application-error");
  return { observeActionFailure: vi.fn(async (error) => toClientSafeError(error)) };
});
vi.mock("../lib/forms/intake-jobs", () => ({ runIntakeSubmissionJob: vi.fn() }));
vi.mock("../components/forms/form-renderer", () => ({
  FormRenderer: ({ schema }: { schema: FormPublishedSchema }) => createElement("h1", null, schema.title),
}));

import { getPublicPublishedSchema } from "../app/f/public-schema";
import { archiveFormAction, loadFormCollectionAvailability, publishFormAction, submitPublicFormAction } from "../app/actions/forms";
import PublicFormPage from "../app/f/[canonicalKey]/page";
import { FormRepository } from "../repositories/form-repository";

const tenantA = "f0f0f0f0-0000-4000-8000-000000000001";
const tenantB = "f0f0f0f0-0000-4000-8000-000000000002";
const schema: FormPublishedSchema = {
  form_id: "f0000000-0000-4000-8000-000000000001", form_type: "contact", canonical_key: "contact",
  form_version_id: "f0000000-0000-4000-8000-000000000002", version_number: 1, schema_hash: "published",
  title: "Published contact", information_html: null, visibility: "public", type_config: {}, fields: [], rules: [],
};
const input: SubmitFormInput = {
  request_id: "f0000000-0000-4000-8000-000000000003", form_version_id: schema.form_version_id,
  context: {}, values: [], files: [],
};
type CacheEntry = { value: { revalidate: number }; tags: string[]; createdAt: number };
const entries = new Map<string, CacheEntry>();

beforeEach(() => {
  vi.resetAllMocks();
  entries.clear();
  // Exercise Next's actual unstable_cache; supply only its platform storage boundary.
  vi.stubGlobal("__incrementalCache", {
    generateSimpleCacheKey: async (key: string) => key,
    get: async (key: string) => {
      const entry = entries.get(key);
      return entry ? { ...entry, isStale: Date.now() - entry.createdAt >= entry.value.revalidate * 1000 } : null;
    },
    set: async (key: string, value: CacheEntry["value"], options: { tags: string[] }) => {
      entries.set(key, { value, tags: options.tags, createdAt: Date.now() });
    },
  });
  state.updateTag.mockImplementation((tag: string) => {
    for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key);
  });
  state.tenant.mockResolvedValue(tenantA);
  state.trusted.mockReturnValue({ rpc: state.rpc });
  state.rpc.mockResolvedValue({ data: schema, error: null });
  state.nextClient.mockResolvedValue({ rpc: state.userRpc });
  state.userRpc.mockResolvedValue({ data: { id: "submission" }, error: null });
  state.bot.mockResolvedValue({ isBot: false });
  state.publish.mockResolvedValue({ version_number: 2 });
  state.archive.mockResolvedValue(undefined);
  state.context.mockResolvedValue({
    actor: {}, user: { tenantId: tenantA, forms: { publish: true, manage: true } },
    services: { forms: { publish: state.publish, archive: state.archive } },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("public schema cache", () => {
  it("keys by verified tenant and normalized canonical key, never by session", async () => {
    await getPublicPublishedSchema(tenantA, "CONTACT");
    await getPublicPublishedSchema(tenantA, "contact");
    await getPublicPublishedSchema(tenantB, "contact");
    state.rpc.mockResolvedValueOnce({ data: { ...schema, canonical_key: "other" }, error: null });
    await getPublicPublishedSchema(tenantA, "other");
    expect(state.rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_tenant_id: tenantA, p_canonical_key: "contact" },
      { p_tenant_id: tenantB, p_canonical_key: "contact" },
      { p_tenant_id: tenantA, p_canonical_key: "other" },
    ]);
    expect(state.nextClient).not.toHaveBeenCalled();
  });

  it("expires after five minutes", async () => {
    vi.useFakeTimers();
    await getPublicPublishedSchema(tenantA, "contact");
    vi.advanceTimersByTime(299_999);
    await getPublicPublishedSchema(tenantA, "contact");
    expect(state.rpc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await getPublicPublishedSchema(tenantA, "contact");
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    { data: null, error: { code: "P0002" } },
    { data: null, error: { code: "08006" } },
    { data: null, error: null },
    { data: {}, error: null },
  ])("does not store missing, failed or malformed responses: %j", async (result) => {
    state.rpc.mockResolvedValueOnce(result);
    await expect(getPublicPublishedSchema(tenantA, "contact")).rejects.toThrow();
    await expect(getPublicPublishedSchema(tenantA, "contact")).resolves.toEqual(schema);
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });

  it.each(["publish", "archive"] as const)("immediately invalidates only the mutation tenant after %s", async (action) => {
    await getPublicPublishedSchema(tenantA, "contact");
    await getPublicPublishedSchema(tenantB, "contact");
    if (action === "publish") await expect(publishFormAction(schema.form_id, input.request_id)).resolves.toMatchObject({ ok: true });
    else await expect(archiveFormAction(schema.form_id, input.request_id)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.updateTag).toHaveBeenCalledWith(`public-forms:${tenantA}`);
    await getPublicPublishedSchema(tenantB, "contact");
    expect(state.rpc).toHaveBeenCalledTimes(2);
    await getPublicPublishedSchema(tenantA, "contact");
    expect(state.rpc).toHaveBeenCalledTimes(3);
  });

  it.each(["publish", "archive"] as const)("preserves the cache after a failed %s", async (action) => {
    state[action].mockRejectedValue(new Error("failed mutation"));
    const result = action === "publish" ? await publishFormAction(schema.form_id, input.request_id)
      : await archiveFormAction(schema.form_id, input.request_id);
    expect(result.ok).toBe(false);
    expect(state.updateTag).not.toHaveBeenCalled();
  });

  it("keeps anonymous availability working after the old RPC grant is revoked", async () => {
    await expect(loadFormCollectionAvailability("contact", schema.form_version_id)).resolves.toBe(true);
    expect(state.userRpc).not.toHaveBeenCalled();
  });

  it("preserves authenticated non-public reads and refuses foreign public fallback", async () => {
    const repository = new FormRepository({ rpc: state.userRpc } as unknown as SupabaseClient<Database>);
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    state.userRpc.mockResolvedValueOnce({ data: { ...schema, visibility: "assigned" }, error: null });
    await expect(repository.getPublishedSchema("contact")).resolves.toMatchObject({ visibility: "assigned" });
    state.userRpc.mockResolvedValueOnce({ data: schema, error: null });
    await expect(repository.getPublishedSchema("contact")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("public page", () => {
  it("renders the published schema for the verified host tenant", async () => {
    const page = await PublicFormPage({ params: Promise.resolve({ canonicalKey: "contact" }), searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(page)).toContain("Published contact");
    expect(state.rpc).toHaveBeenCalledWith("app_get_public_form_schema", { p_tenant_id: tenantA, p_canonical_key: "contact" });
  });
  it.each(["unpublished", "archived", "foreign-tenant"])("404s %s forms", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    await expect(PublicFormPage({ params: Promise.resolve({ canonicalKey: "contact" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("does not turn database outages into cached 404s", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(PublicFormPage({ params: Promise.resolve({ canonicalKey: "contact" }), searchParams: Promise.resolve({}) })).rejects.toMatchObject({ code: "DATABASE_ERROR" });
    expect(entries.size).toBe(0);
  });
});

describe("public submission BotId boundary", () => {
  it("protects POST /f/* alongside login", () => {
    const source = readFileSync(new URL("../instrumentation-client.ts", import.meta.url), "utf8");
    expect(source).toContain('path: "/f/*", method: "POST"');
    expect(source).toContain('path: "/login", method: "POST"');
  });
  it("allows a human through the existing submission RPC with the original idempotency key", async () => {
    await expect(submitPublicFormAction(input)).resolves.toEqual({ ok: true, data: { id: "submission" } });
    expect(state.userRpc).toHaveBeenCalledWith("app_submit_form", {
      p_request_id: input.request_id, p_form_version_id: input.form_version_id, p_context: {}, p_values: [], p_files: [],
    });
  });
  it.each([{ isBot: true }, {}, null])("rejects non-human or missing verdicts before database access: %j", async (verdict) => {
    state.bot.mockResolvedValue(verdict);
    await expect(submitPublicFormAction(input)).resolves.toMatchObject({ ok: false });
    expect(state.nextClient).not.toHaveBeenCalled();
    expect(state.userRpc).not.toHaveBeenCalled();
  });
  it("fails closed if verification is unavailable", async () => {
    state.bot.mockRejectedValue(new Error("provider unavailable"));
    await expect(submitPublicFormAction(input)).resolves.toMatchObject({ ok: false });
    expect(state.nextClient).not.toHaveBeenCalled();
  });
  it("preserves database ceiling failures after a human verdict", async () => {
    state.userRpc.mockResolvedValue({ data: null, error: { code: "WF429" } });
    await expect(submitPublicFormAction(input)).resolves.toEqual({ ok: false, error: "Too many requests. Please wait a moment and try again." });
  });
});
