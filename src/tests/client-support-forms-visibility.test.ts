import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import { clientSupportFetch } from "../lib/supabase/client-support-fetch";
import { FormRepository } from "../repositories/form-repository";
import { FormService } from "../services/form-service";
import { loadFormsVisibility } from "../app/actions/forms-visibility";

const state = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: state.context, getInternalContext: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

const assignmentId = "f1750000-0000-4000-8000-000000000001";
const submissionId = "f1750000-0000-4000-8000-000000000002";
const orderId = "f1750000-0000-4000-8000-000000000003";
const calls: string[] = [];
let denied = false;

beforeEach(() => {
  calls.length = 0;
  denied = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const name = path.split("/").at(-1)!;
    calls.push(name);
    if (denied && name === "app_list_form_submissions") {
      return Response.json({ code: "42501", message: "Permission denied" }, { status: 403 });
    }
    switch (name) {
      case "app_forms_work_enabled": return Response.json(true);
      case "app_list_form_submissions": return Response.json([{ id: submissionId, order_id: orderId }]);
      case "app_list_assigned_forms": return Response.json([{ assignment_id: assignmentId, form_type: "intake", order_id: orderId }]);
      case "app_get_assigned_form_service_labels": return Response.json([{ assignment_id: assignmentId, service_name: "Synthetic service" }]);
      default: throw new Error(`Unexpected request: ${name}`);
    }
  }));
  const client = createClient<Database>("https://provider.example.invalid", "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: clientSupportFetch("https://provider.example.invalid") },
  });
  state.context.mockResolvedValue({
    user: { id: "synthetic-client", tenantId: "synthetic-tenant", companyId: "synthetic-company", modules: { forms: true } },
    services: { forms: new FormService({ repository: new FormRepository(client) }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("client support Onboarding visibility dependency", () => {
  it("loads through the real action, service, repository and restricted fetch", async () => {
    const result = await loadFormsVisibility("client");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Client visibility was rejected");
    expect(JSON.parse(result.signature).recordIds).toEqual([
      `assignment:${assignmentId}`, `assignment:${assignmentId}:project:${orderId}`,
      `submission:${submissionId}`, `submission:${submissionId}:project:${orderId}`,
    ].sort());
    expect(calls).toContain("app_list_form_submissions");
    expect(calls).toContain("app_get_assigned_form_service_labels");
  });

  it("still fails closed when the database refuses submission access", async () => {
    denied = true;
    expect(await loadFormsVisibility("client")).toEqual({ ok: false, denied: true });
    expect(calls).toContain("app_list_form_submissions");
  });
});
