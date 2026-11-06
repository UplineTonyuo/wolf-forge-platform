import { z } from "zod";
import { readDailyCallConfig } from "../../../lib/daily/calls";
import { callMutation, callRead } from "../../../domain/tickets/calls";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { getVerifiedSessionContext } from "../../../lib/supabase/next-server";
import { endTicketCall, mutateTicketCall, readTicketCalls } from "../../../services/ticket-call-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
function failure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return json({ ok: false, code: code === "PERMISSION_DENIED" || code === "RATE_LIMITED" ? code : "CALL_SERVICE_UNAVAILABLE", error: "This call is unavailable. Check your access, connection or call usage limit." },
    code === "PERMISSION_DENIED" ? 403 : code === "RATE_LIMITED" ? 429 : 503);
}
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if (origin ? !requestIsSameOrigin(request) : request.headers.get("sec-fetch-site") !== "same-origin") return json({ ok: false }, 403);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (!("action" in query)) return json({ ok: true, enabled: false, call: null });
  const input = callRead.safeParse(query);
  if (!input.success) return json({ ok: false }, 400);
  try {
    const context = await getVerifiedSessionContext();
    if (!context) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);
    if (context.actor?.support) return json({ ok: false, code: "SUPPORT_MODE" }, 403);
    const data = await readTicketCalls(context.client, input.data);
    return json({ ok: true, data: input.data.action === "current" || input.data.action === "prepare" ? { ...data, enabled: Boolean(readDailyCallConfig()) && "enabled" in data && data.enabled } : data });
  } catch (error) { return failure(error); }
}
async function mutate(request: Request, ending = false) {
  if (!requestIsSameOrigin(request)) return json({ ok: false }, 403);
  const body = await readBoundedJson(request, 2048);
  if (!body.ok) return json({ ok: false }, body.status);
  const input = ending
    ? z.object({ ticket_id: z.uuid(), call_id: z.uuid() }).strict().safeParse(body.value)
    : callMutation.safeParse(body.value);
  if (!input.success) return json({ ok: false }, 400);
  try {
    const context = await getVerifiedSessionContext();
    if (!context) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);
    if (context.actor?.support) return json({ ok: false, code: "SUPPORT_MODE" }, 403);
    if (!ending && "action" in input.data && ["request", "accept"].includes(input.data.action) && !readDailyCallConfig()) {
      return json({ ok: false, code: "CALLING_DISABLED", error: "Calling is unavailable." }, 503);
    }
    return json({ ok: true, data: ending
      ? await endTicketCall(context.client, (input.data as { ticket_id: string }).ticket_id, (input.data as { call_id: string }).call_id)
      : await mutateTicketCall(context.client, input.data) });
  } catch (error) { return failure(error); }
}
export const POST = (request: Request) => mutate(request);
export const DELETE = (request: Request) => mutate(request, true);
