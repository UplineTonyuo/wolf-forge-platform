import { z } from "zod";
import { readDailyCallConfig } from "../../../lib/daily/calls";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { getVerifiedSessionContext } from "../../../lib/supabase/next-server";
import { callOperation, endTicketCall, joinTicketCall } from "../../../services/ticket-call-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const target = z.object({ ticket_id: z.uuid() }).strict();
const join = target.extend({ request_id: z.uuid(), mode: z.enum(["audio", "video"]) }).strict();
const end = target.extend({ call_id: z.uuid() }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

function failure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return json({ ok: false, error: "This call is unavailable. Check your access, connection or call usage limit." },
    code === "PERMISSION_DENIED" ? 403 : code === "RATE_LIMITED" ? 429 : 503);
}

export async function GET(request: Request) {
  if (!readDailyCallConfig()) return json({ ok: true, enabled: false, call: null });
  const origin = request.headers.get("origin");
  if (origin ? !requestIsSameOrigin(request) : request.headers.get("sec-fetch-site") !== "same-origin") return json({ ok: false }, 403);
  const input = target.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return json({ ok: false }, 400);
  try {
    const context = await getVerifiedSessionContext();
    if (!context) return json({ ok: false }, 401);
    const call = await callOperation(context.client, "status", input.data.ticket_id);
    return json({ ok: true, enabled: true, call });
  } catch (error) { return failure(error); }
}

async function mutate(request: Request, ending: boolean) {
  if (!readDailyCallConfig()) return json({ ok: false }, 404);
  if (!requestIsSameOrigin(request)) return json({ ok: false }, 403);
  const body = await readBoundedJson(request, 1024);
  if (!body.ok) return json({ ok: false, error: body.error }, body.status);
  try {
    const context = await getVerifiedSessionContext();
    if (!context) return json({ ok: false }, 401);
    if (ending) {
      const input = end.safeParse(body.value);
      if (!input.success) return json({ ok: false }, 400);
      return json({ ok: true, data: await endTicketCall(context.client, input.data.ticket_id, input.data.call_id) });
    }
    const input = join.safeParse(body.value);
    if (!input.success) return json({ ok: false }, 400);
    return json({ ok: true, data: await joinTicketCall(context.client, context.actor.id, input.data.ticket_id, {
      requestId: input.data.request_id, mode: input.data.mode,
    }) });
  } catch (error) { return failure(error); }
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
