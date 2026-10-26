import "server-only";
import { z } from "zod";
import { callRoomProperties, dailyRequest, readDailyCallConfig, verifiedCallRoom } from "../lib/daily/calls";
import { readServerEnvironment } from "../lib/env/server-env";
import { createTrustedServerSupabaseClient } from "../lib/supabase/trusted-server-client";
import type { UserScopedClient } from "../lib/supabase/user-client";
import { mapDatabaseError } from "../lib/errors/map-database-error";

const callSchema = z.object({
  id: z.uuid(), mode: z.enum(["audio", "video"]), expiresAt: z.iso.datetime({ offset: true }),
  state: z.enum(["reserved", "ready", "ended"]), created: z.boolean(),
  endClaim: z.boolean(), participantIds: z.array(z.uuid()).min(1).max(2),
  roomName: z.string().regex(/^wf-call-[a-f0-9-]{36}$/),
});
type Call = z.infer<typeof callSchema>;
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw mapDatabaseError(result.error, "Call");
  return result.data;
}

export function callOperation(client: UserScopedClient, action: string, ticketId: string, input: {
  requestId?: string; callId?: string; mode?: string;
} = {}) {
  return rpc(client as unknown as RpcClient, "app_ticket_call", {
    p_action: action, p_ticket_id: ticketId, p_request_id: input.requestId,
    p_call_id: input.callId, p_mode: input.mode,
  });
}

export async function joinTicketCall(client: UserScopedClient, actorId: string, ticketId: string, input: {
  requestId: string; mode: "audio" | "video";
}) {
  const config = readDailyCallConfig();
  if (!config) throw new Error("Calls are disabled");
  const reserved = callSchema.parse(await callOperation(client, "reserve", ticketId, input));
  const expires = Math.floor(Date.parse(reserved.expiresAt) / 1000);
  if (expires <= Date.now() / 1000 || expires > Date.now() / 1000 + 901) throw new Error("Call expired");
  // Only the transaction that durably reserved creation may POST a new room.
  if (reserved.created) {
    try { await dailyRequest(config.key, "rooms", "POST", { name: reserved.roomName, privacy: "private", properties: callRoomProperties(expires) }); }
    catch { /* Reconcile the exact room after an uncertain provider response. */ }
  }
  const room = await dailyRequest(config.key, `rooms/${reserved.roomName}`);
  if (!verifiedCallRoom(room, reserved.roomName, expires)) throw new Error("Call setup is unavailable");
  if (reserved.state === "reserved") {
    const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
    await rpc(trusted as unknown as RpcClient, "app_complete_ticket_call_setup", { p_call_id: reserved.id });
  }
  // Re-authorizes the live session and spends a token attempt before issuance.
  const joined: Call = callSchema.parse(await callOperation(client, "join", ticketId, { callId: reserved.id }));
  const token = await dailyRequest(config.key, "meeting-tokens", "POST", { properties: {
    room_name: joined.roomName, user_id: actorId, user_name: "Wolf Forge participant",
    is_owner: false, nbf: Math.floor(Date.now() / 1000) - 5, exp: expires,
    eject_at_token_exp: true, enable_screenshare: false, start_video_off: joined.mode === "audio",
    enable_recording: false, enable_recording_ui: false, enable_live_captions_ui: false,
    start_cloud_recording: false, auto_start_transcription: false,
    permissions: { hasPresence: true, canSend: joined.mode === "audio" ? ["audio"] : ["audio", "video"], canAdmin: false },
  } });
  if (!token || typeof token !== "object" || !("token" in token) || typeof token.token !== "string" ||
    token.token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token.token)) throw new Error("Call connection unavailable");
  return { callId: joined.id, roomUrl: `${config.origin}/${joined.roomName}`, token: token.token, mode: joined.mode, expiresAt: joined.expiresAt };
}

export async function endTicketCall(client: UserScopedClient, ticketId: string, callId: string) {
  const config = readDailyCallConfig();
  if (!config) throw new Error("Calls are disabled");
  const ended = callSchema.parse(await callOperation(client, "end", ticketId, { callId }));
  const endpoint = `rooms/${ended.roomName}`;
  if (!ended.endClaim) return { ended: true, roomDeleted: false };
  try { await dailyRequest(config.key, `${endpoint}/eject`, "POST", { user_ids: ended.participantIds, ban: true }); }
  catch { /* The same durable end claim also owns room deletion below. */ }
  try { await dailyRequest(config.key, endpoint, "DELETE"); } catch { /* Expiry remains the hard bound if deletion is uncertain. */ }
  return { ended: true, roomDeleted: await dailyRequest(config.key, endpoint) === null };
}
