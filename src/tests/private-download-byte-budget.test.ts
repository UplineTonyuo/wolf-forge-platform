import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError, RateLimitedError } from "../lib/errors/application-error";
import { enforcePrivateDownloadByteBudget } from "../lib/security/server-cost-limit";

const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/env/server-env", () => ({ readServerEnvironment: () => ({}) }));
vi.mock("../lib/supabase/trusted-server-client", () => ({
  createTrustedServerSupabaseClient: () => ({
    marker: true,
    rpc(this: { marker: boolean }, name: string, args: unknown) {
      if (!this.marker) throw new Error("unbound RPC");
      return m.rpc(name, args);
    },
  }),
}));

beforeEach(() => m.rpc.mockReset().mockResolvedValue({ error: null }));
const input = { actorId: "10000000-0000-4000-8000-000000000001", tenantId: "20000000-0000-4000-8000-000000000001", sizeBytes: 5242880 };

describe("private download byte accounting", () => {
  it("reserves authorized metadata using the trusted RPC with its receiver intact", async () => {
    await enforcePrivateDownloadByteBudget(input);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("app_consume_private_download_byte_budget", {
      p_actor_id: input.actorId, p_tenant_id: input.tenantId, p_bytes: input.sizeBytes,
    });
  });

  it("uses the existing RATE_LIMITED mapping without leaking database details", async () => {
    m.rpc.mockResolvedValue({ error: { code: "WF429", message: "private counter detail" } });
    await expect(enforcePrivateDownloadByteBudget(input)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(enforcePrivateDownloadByteBudget(input)).rejects.toMatchObject({ code: "RATE_LIMITED", message: new RateLimitedError().message });
  });

  it("fails closed for an unavailable database", async () => {
    m.rpc.mockResolvedValue({ error: { code: "XX000" } });
    await expect(enforcePrivateDownloadByteBudget(input)).rejects.toBeInstanceOf(DatabaseError);
  });

  it("preserves the exact current metadata authorization bodies and their cleanup guard", () => {
    const read = (name: string) => readFileSync(new URL("../../supabase/migrations/" + name, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const next = read("20261029180349_private_download_byte_budget.sql");
    const ticket = read("20260926203443_client_conversation_notifications_and_project_purchase.sql");
    const ticketBody = ticket.slice(ticket.indexOf("create or replace function public.app_get_ticket_attachment_download"), ticket.indexOf("create function public.app_toggle_order_message_reaction"));
    const originalTicket = next.slice(next.indexOf("create or replace function public.app_get_ticket_attachment_download"), next.indexOf("create or replace function public.app_get_intake_file"))
      .replace(",\n      'size_bytes', ticket_attachment.size_bytes, 'tenant_id', ticket_row.tenant_id", "")
      .replace(",\n    'size_bytes', project_attachment.size_bytes,\n    'tenant_id', (select tenant_id from public.orders where id = project_attachment.order_id)", "");
    expect(originalTicket.trim()).toBe(ticketBody.trim());
    const intake = read("20261023205322_intake_orphan_cleanup_claims.sql");
    const body = intake.slice(intake.indexOf("declare upload private.intake_uploads;"), intake.indexOf("$function$;", intake.indexOf("declare upload private.intake_uploads;")));
    expect(next).toContain(body.replace("'path',upload.object_key);", "'path',upload.object_key,\n    'tenant_id',(select f.tenant_id from public.forms f join public.form_assignments a on a.form_id=f.id where a.id=upload.assignment_id));"));
  });
});
