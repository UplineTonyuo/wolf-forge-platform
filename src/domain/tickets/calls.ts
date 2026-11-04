import { z } from "zod";

const id = z.uuid();
export const callOutcome = z.enum(["answered", "declined", "missed", "expired", "busy", "refused"]);
export const ticketCall = z.object({
  id, ticketId: id.nullable(), orderId: id.nullable().optional(), callerId: id, calleeId: id.nullable(),
  mode: z.enum(["audio", "video"]), direction: z.enum(["client_to_team", "team_to_client"]),
  state: z.enum(["ringing", "accepted", "connecting", "active", "ending", "ended"]),
  requestedAt: z.iso.datetime({ offset: true }), ringDeadline: z.iso.datetime({ offset: true }).nullable(),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(), answeredAt: z.iso.datetime({ offset: true }).nullable(),
  endedAt: z.iso.datetime({ offset: true }).nullable(), expiresAt: z.iso.datetime({ offset: true }),
  outcome: callOutcome.nullable(), reason: z.string().max(100).nullable(), version: z.number().int().positive(),
  connectedSeconds: z.number().nonnegative(), participantSeconds: z.number().nonnegative(),
  reconciled: z.boolean(), message: z.string().max(200).nullable(),
});
export type TicketCall = z.infer<typeof ticketCall>;

export const callPerson = z.object({
  name: z.string().min(1).max(200), avatarUrl: z.string().max(2048).nullable(),
  role: z.string().min(1).max(100).optional(),
}).strict();
export const callCandidate = callPerson.extend({ profileId: id });
export type CallCandidate = z.infer<typeof callCandidate>;
export const callHistoryEntry = ticketCall.extend({ caller: callPerson, callee: callPerson.nullable() });
export type CallHistoryEntry = z.infer<typeof callHistoryEntry>;

export const callAvailability = z.object({
  enabled: z.boolean(), profileId: id, accountClass: z.enum(["internal", "client"]),
  call: ticketCall.nullable(), ticketId: id.nullable(), orderId: id.nullable().optional(),
  peer: callPerson.nullable(),
  candidates: z.array(callCandidate).max(100).optional(),
}).strict().refine(value => !value.call ||
  ((value.profileId === value.call.callerId || value.profileId === value.call.calleeId) && value.ticketId === value.call.ticketId && (value.orderId ?? null) === (value.call.orderId ?? null)));
export type CallAvailability = z.infer<typeof callAvailability>;

export const callRequest = z.object({
  action: z.literal("request"), ticket_id: id, request_id: id, device_id: id,
  mode: z.enum(["audio", "video"]),
  recipient_id: id.optional(),
}).strict();
export const orderCallRequest = callRequest.omit({ ticket_id: true }).extend({ order_id: id });
export const callCommand = z.object({
  action: z.enum(["status", "accept", "decline", "cancel", "end"]), call_id: id,
  device_id: id.optional(),
}).strict().refine(value => value.action !== "accept" || value.device_id !== undefined);
export const callSettings = z.object({
  action: z.literal("settings"), enabled: z.boolean(), fallback_profile_id: id.nullable(),
  monthly_minutes: z.number().int().min(1).max(5400),
}).strict();
export const callMutation = z.union([callRequest, orderCallRequest, callCommand, callSettings]);
export const callRead = z.union([
  z.object({ action: z.literal("prepare"), ticket_id: id }).strict(),
  z.object({ action: z.literal("prepare"), order_id: id }).strict(),
  z.object({ action: z.literal("current"), order_id: id }).strict(),
  z.object({ action: z.literal("current"), ticket_id: id.optional(), call_id: id.optional() }).strict()
    .refine(value => !value.ticket_id || !value.call_id),
  z.object({ action: z.literal("history"), ticket_id: id, before: z.iso.datetime({ offset: true }).optional(), before_id: id.optional() })
    .strict().refine(value => (value.before === undefined) === (value.before_id === undefined)),
  z.object({ action: z.literal("history"), order_id: id, before: z.iso.datetime({ offset: true }).optional(), before_id: id.optional() })
    .strict().refine(value => (value.before === undefined) === (value.before_id === undefined)),
  z.object({ action: z.literal("summary"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) }).strict(),
]);
export const callOwnerSummary = z.object({
  made: z.number().int().nonnegative(), answered: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(), connectedSeconds: z.number().nonnegative(),
}).strict();

// This contract enrolls no device and sends no notification.
export const incomingCallPush = z.object({
  title: z.literal("Incoming call from Wolf Forge"),
  body: z.literal("Open Wolf Forge to answer."), callId: id,
  version: z.number().int().positive(),
}).strict();

export const callEvidence = z.object({
  account: z.literal("wolfforge"), callId: id,
  eventId: z.string().min(1).max(128), meetingId: z.string().min(1).max(128),
  endedAt: z.iso.datetime({ offset: true }),
  intervals: z.array(z.object({
    sessionId: z.string().min(1).max(128), profileId: id,
    joinedAt: z.iso.datetime({ offset: true }), leftAt: z.iso.datetime({ offset: true }),
  }).strict()).max(128),
}).strict();
