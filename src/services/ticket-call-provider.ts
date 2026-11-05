import "server-only";
import { z } from "zod";
import { callEvidence, ticketCall } from "../domain/tickets/calls";
import { callRoomProperties, DAILY_CALL_ORIGIN, verifiedCallRoom } from "../lib/daily/calls";
import { callRpc, type CallRpc } from "./ticket-call-service";

// All provider operations run behind durable database claims, never browser commands.
export type CallProvider = {
  createRoom(name: string, properties: ReturnType<typeof callRoomProperties>): Promise<unknown>;
  readRoom(name: string): Promise<unknown>;
  createToken(properties: Record<string, unknown>): Promise<unknown>;
  ejectRoom(name: string): Promise<unknown>;
  deleteRoom(name: string): Promise<unknown>;
};
const roomClaim = z.object({
  id: z.uuid(), roomName: z.string().regex(/^wf-call-[a-f0-9-]{36}$/), mode: z.enum(["audio", "video"]),
  expiresAt: z.iso.datetime({ offset: true }), created: z.boolean(), ready: z.boolean().default(false), claimId: z.uuid(),
});
const tokenClaim = roomClaim.omit({ created: true, claimId: true }).extend({ participantId: z.uuid() });

export async function prepareTicketCallMedia(user: CallRpc, trusted: CallRpc, provider: CallProvider, callId: string, deviceId: string) {
  const args = { p_call_id: z.uuid().parse(callId), p_device_id: z.uuid().parse(deviceId) };
  const claim = roomClaim.parse(await callRpc(user, "app_ticket_call_command", { ...args, p_action: "setup" }));
  if (claim.id !== callId || claim.roomName !== `wf-call-${callId}`) throw new Error("Unexpected room claim");
  const expiry = Math.floor(Date.parse(claim.expiresAt) / 1000);
  if (expiry <= Date.now() / 1000 || expiry > Date.now() / 1000 + 901) throw new Error("Call expired");
  if (!claim.ready) {
    if (claim.created) {
      try { await provider.createRoom(claim.roomName, callRoomProperties(expiry)); }
      catch { /* Read the deterministic room after an uncertain creation. */ }
    }
    const room = await provider.readRoom(claim.roomName);
    if (!verifiedCallRoom(room, claim.roomName, expiry)) throw new Error("Call setup unavailable");
    const completed = await callRpc(trusted, "app_complete_ticket_call_room", {
      p_call_id: callId, p_claim_id: claim.claimId, p_room: room,
    });
    if (completed !== true) throw new Error("Call setup unavailable");
  }
  const joined = tokenClaim.parse(await callRpc(user, "app_ticket_call_command", { ...args, p_action: "join" }));
  if (joined.id !== callId || joined.roomName !== claim.roomName || joined.expiresAt !== claim.expiresAt || joined.mode !== claim.mode) {
    throw new Error("Call changed");
  }
  const result = await provider.createToken({
    room_name: joined.roomName, user_id: joined.participantId, user_name: "Wolf Forge participant", is_owner: false,
    nbf: Math.floor(Date.now() / 1000) - 5, exp: expiry, eject_at_token_exp: true,
    enable_screenshare: false, start_video_off: joined.mode === "audio",
    enable_recording: false, enable_recording_ui: false, enable_live_captions_ui: false,
    start_cloud_recording: false, auto_start_transcription: false,
    permissions: { hasPresence: true, canSend: joined.mode === "audio" ? ["audio"] : ["audio", "video"], canAdmin: false },
  });
  const token = z.object({ token: z.string().max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) }).parse(result).token;
  z.object({ state: z.enum(["connecting", "active"]) }).parse(
    await callRpc(user, "app_ticket_call_command", { ...args, p_action: "status" }),
  );
  return { callId, token, roomUrl: `${DAILY_CALL_ORIGIN}/${joined.roomName}`, mode: joined.mode, expiresAt: joined.expiresAt };
}

export async function reconcileTicketCallCleanup(trusted: CallRpc, provider: CallProvider) {
  const batch = z.array(z.object({ id: z.uuid(), claimId: z.uuid(), roomName: z.string(), reconcileOnly: z.boolean() })).max(10)
    .parse(await callRpc(trusted, "app_claim_ticket_call_cleanup", {}));
  let absent = 0;
  for (const work of batch) {
    if (work.roomName !== `wf-call-${work.id}`) throw new Error("Unexpected cleanup room");
    let verified = false;
    try {
      const room = await provider.readRoom(work.roomName);
      if (room === null) verified = true;
      else if (!work.reconcileOnly) {
        await provider.ejectRoom(work.roomName);
        await provider.deleteRoom(work.roomName);
        verified = await provider.readRoom(work.roomName) === null;
      }
    } catch { /* Preserve unknown claims and usage holds; never blindly resend. */ }
    if (await callRpc(trusted, "app_finish_ticket_call_cleanup", {
      p_call_id: work.id, p_claim_id: work.claimId, p_verified: verified,
    }) !== true) throw new Error("Cleanup receipt unavailable");
    if (verified) absent++;
  }
  // Room absence does not certify media termination or settle participant usage.
  return { absent };
}

export async function confirmTicketCallPresence(user:CallRpc,trusted:CallRpc,provider:CallProvider & {readPresence(name:string):Promise<unknown>},callId:string,deviceId:string){
  const joined=roomClaim.omit({created:true,claimId:true}).parse(await callRpc(user,"app_ticket_call_media_probe",{p_call_id:z.uuid().parse(callId),p_device_id:z.uuid().parse(deviceId)}));
  if(joined.id!==callId||joined.roomName!==`wf-call-${callId}`)throw new Error("Unexpected room claim");
  const presence=z.object({total_count:z.literal(2),data:z.array(z.object({id:z.string().min(1).max(128),room:z.literal(joined.roomName),userId:z.uuid()})).length(2)})
    .parse(await provider.readPresence(joined.roomName));
  return ticketCall.parse(await callRpc(trusted,"app_confirm_ticket_call_presence",{p_call_id:callId,p_presence:presence}));
}

export async function ingestTicketCallEvidence(trusted: CallRpc, value: unknown, complete = false) {
  const evidence = callEvidence.parse(value);
  return z.boolean().parse(await callRpc(trusted, "app_ingest_ticket_call_evidence", { p_evidence: evidence, p_complete: complete }));
}

export async function reconcileTicketCallAccount(trusted: CallRpc, value: unknown) {
  const input = z.object({ account: z.literal("wolfforge"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),
    unmappedSeconds: z.number().finite().nonnegative(), observedAt: z.iso.datetime({ offset: true }),
  }).strict().parse(value);
  return z.boolean().parse(await callRpc(trusted, "app_reconcile_ticket_call_account", {
    p_account: input.account, p_month: input.month, p_unmapped_seconds: input.unmappedSeconds, p_observed_at: input.observedAt,
  }));
}
