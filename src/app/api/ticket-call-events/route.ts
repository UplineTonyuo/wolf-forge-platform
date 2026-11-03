import { z } from "zod";
import { ApplicationError } from "../../../lib/errors/application-error";
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
  let leaseExpiry: ReturnType<typeof setTimeout> | undefined;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let leaseId: string | undefined;
  let cancelSubscription: (() => void) | undefined;
  const encoder = new TextEncoder();
  const release = () => {
    if (!leaseId) return;
    const id = leaseId;
    leaseId = undefined;
    void callRpc(client, "app_ticket_call_signal_lease", { p_action: "release", p_lease_id: id }).catch(() => {});
  };
  const close = () => {
    if (!closed) {
      closed = true;
      clearTimeout(expiry);
      clearTimeout(leaseExpiry);
      clearTimeout(renewal);
      cancelSubscription?.();
      request.signal.removeEventListener("abort", close);
      if (channel) void client.removeChannel(channel).catch(() => {}).finally(() => { void client.realtime.disconnect().catch(() => {}); });
      else void client.realtime.disconnect().catch(() => {});
      controller?.close();
    }
    release(); // Admission can finish after an earlier abort.
  };
  const armLease = (expiresAt: string) => {
    clearTimeout(leaseExpiry);
    const remaining = Date.parse(expiresAt) - Date.now() - 1000;
    if (remaining <= 0) close();
    else leaseExpiry = setTimeout(close, remaining);
  };
  const renew = async () => {
    if (closed || !leaseId) return;
    try {
      const value = await callRpc(client, "app_ticket_call_signal_lease", { p_action: "renew", p_lease_id: leaseId });
      if (closed) return;
      armLease(z.object({ expiresAt: z.iso.datetime({ offset: true }) }).strict().parse(value).expiresAt);
      if (!closed) renewal = setTimeout(() => { void renew(); }, 30000);
    } catch { close(); }
  };
  const wake = () => { if (!closed) controller?.enqueue(encoder.encode("event: wake\ndata: {}\n\n")); };
  request.signal.addEventListener("abort", close, { once: true });
  if (request.signal.aborted) { close(); return new Response(null, { status: 204, headers: noStore }); }
  try {
    const data = await callRpc(client, "app_ticket_call_signal_context", {});
    if (data === null) { close(); return disabled(); }
    const parsed = z.object({ topic: z.string(), leaseId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) }).strict().parse(data);
    leaseId = parsed.leaseId;
    if (closed) { close(); return new Response(null, { status: 204, headers: noStore }); }
    const parts = parsed.topic.split(":");
    if (parts.length !== 3 || parts[0] !== "ticket-calls" || !z.uuid().safeParse(parts[1]).success || parts[2] !== context.actor.id) {
      close();
      return new Response(null, { status: 403, headers: noStore });
    }
    armLease(parsed.expiresAt);
    if (closed) return new Response(null, { status: 503, headers: noStore });
    const ttl = await authenticateUserRealtime(client);
    if (closed) return new Response(null, { status: 204, headers: noStore });
    channel = client.channel(parsed.topic, { config: { private: true } }).on("broadcast", { event: "call" }, wake);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Call signal unavailable")), 8000);
      cancelSubscription = () => { clearTimeout(timeout); reject(new Error("Call signal closed")); };
      channel!.subscribe(status => {
        if (status === "SUBSCRIBED") { clearTimeout(timeout); cancelSubscription = undefined; resolve(); }
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
        expiry = setTimeout(close, ttl);
        renewal = setTimeout(() => { void renew(); }, 30000);
      },
      cancel() { controller = undefined; close(); },
    });
    return new Response(body, { headers: { ...noStore, "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" } });
  } catch (error) {
    close();
    if (error instanceof ApplicationError && error.code === "RATE_LIMITED") {
      return new Response(null, { status: 429, headers: { ...noStore, "Retry-After": "90" } });
    }
    return new Response(null, { status: 503, headers: noStore });
  }
}
