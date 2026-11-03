import { z } from "zod";
import { readDailyCallConfig } from "../../../lib/daily/calls";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { getVerifiedSessionContext } from "../../../lib/supabase/next-server";
import { authenticateUserRealtime } from "../../../lib/supabase/user-client";
import { callRpc } from "../../../services/ticket-call-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const disabled = () => new Response("event: disabled\ndata: {}\n\n", { headers: { ...noStore, "Content-Type": "text/event-stream" } });

/** One event-driven connection; there is no database poll or browser bearer token. */
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if (origin ? !requestIsSameOrigin(request) : request.headers.get("sec-fetch-site") !== "same-origin") {
    return new Response(null, { status: 403, headers: noStore });
  }
  if (!readDailyCallConfig()) return disabled();
  const context = await getVerifiedSessionContext().catch(() => null);
  if (!context) return new Response(null, { status: 401, headers: noStore });
  if (context.actor.support) return new Response(null, { status: 403, headers: noStore });
  const { client } = context;
  let channel: ReturnType<typeof client.channel> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const encoder = new TextEncoder();
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(expiry);
    request.signal.removeEventListener("abort", close);
    if (channel) void client.removeChannel(channel).catch(() => {}).finally(() => { void client.realtime.disconnect().catch(() => {}); });
    controller?.close();
  };
  const wake = () => { if (!closed) controller?.enqueue(encoder.encode("event: wake\ndata: {}\n\n")); };
  try {
    const data = await callRpc(client, "app_ticket_call_signal_context", {});
    if (data === null) return disabled();
    const parsed = z.object({ topic: z.string() }).strict().parse(data);
    const parts = parsed.topic.split(":");
    if (parts.length !== 3 || parts[0] !== "ticket-calls" || !z.uuid().safeParse(parts[1]).success || parts[2] !== context.actor.id) {
      return new Response(null, { status: 403, headers: noStore });
    }
    const ttl = await authenticateUserRealtime(client);
    channel = client.channel(parsed.topic, { config: { private: true } }).on("broadcast", { event: "call" }, wake);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Call signal unavailable")), 8000);
      channel!.subscribe(status => {
        if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          clearTimeout(timeout); reject(new Error("Call signal unavailable")); close();
        }
      });
    });
    if (request.signal.aborted || closed) { close(); return new Response(null, { status: 204, headers: noStore }); }
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        value.enqueue(encoder.encode("retry: 10000\n\n"));
        wake(); // Read after subscription so admission during connection cannot be lost.
        request.signal.addEventListener("abort", close, { once: true });
        expiry = setTimeout(close, ttl);
      },
      cancel() { controller = undefined; close(); },
    });
    return new Response(body, { headers: { ...noStore, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" } });
  } catch {
    close();
    return new Response(null, { status: 503, headers: noStore });
  }
}
