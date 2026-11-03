import { z } from "zod";
import { pushEndpointSchema } from "../../../domain/notifications/push";
import { callPushContext } from "../../../lib/notifications/call-push-server";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";

export const dynamic = "force-dynamic";
const input = z.union([
  z.object({ action: z.literal("status"), endpoint: pushEndpointSchema }).strict(),
  z.object({ action: z.literal("set"), endpoint: pushEndpointSchema, enabled: z.boolean() }).strict(),
]);
const callPushStatus = z.object({ active: z.boolean(), call: z.object({ id: z.uuid(), version: z.number().int().positive() }).strict().nullable() }).strict();
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if (origin ? !requestIsSameOrigin(request) : request.headers.get("sec-fetch-site") !== "same-origin") return reply({ ok: false },403);
  try {
    const context = await callPushContext();
    return context ? reply({ ok: true, data: context.config }) : reply({ ok: false },403);
  } catch { return reply({ ok: false },503); }
}
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return reply({ ok: false },403);
  const body = await readBoundedJson(request,3072);
  if (!body.ok) return reply({ ok: false },body.status);
  const parsed = input.safeParse(body.value);
  if (!parsed.success) return reply({ ok: false },400);
  try {
    const context = await callPushContext();
    if (!context) return reply({ ok: false },403);
    const value = parsed.data;
    const result = value.action === "set"
      ? await context.rpc("app_set_my_call_push_subscription", { p_endpoint: value.endpoint, p_origin: context.config.origin, p_enabled: value.enabled })
      : await context.rpc("app_my_call_push_status", { p_endpoint: value.endpoint });
    if (result.error) return reply({ ok: false },503);
    return reply({ ok: true, data: value.action === "set" ? z.literal(true).parse(result.data) : callPushStatus.parse(result.data) });
  } catch { return reply({ ok: false },503); }
}
