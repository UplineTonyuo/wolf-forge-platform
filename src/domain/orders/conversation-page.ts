import { z } from "zod";
import { uuidSchema } from "../shared";
import type { TicketDetail, TicketDetailMessage } from "../tickets/schema";
import type { CallHistoryEntry } from "../tickets/calls";

export const orderPageInputSchema = z.object({
  direction: z.enum(["latest", "before", "after", "refresh"]).default("latest"),
  cursor: z.string().min(1).max(1000).nullable().default(null),
  retainedIds: z.array(uuidSchema).max(100).default([]),
  requestIds: z.array(uuidSchema).max(100).default([]),
  fingerprint: z.string().max(128).nullable().default(null),
}).strict().superRefine((input, context) => {
  if ((input.direction === "before" || input.direction === "after") !== Boolean(input.cursor)) {
    context.addIssue({ code: "custom", message: "A history cursor is required only for a directional page." });
  }
  if (input.direction !== "refresh" && (input.retainedIds.length || input.requestIds.length || input.fingerprint)) {
    context.addIssue({ code: "custom", message: "Retained records belong to a refresh request." });
  }
});

export type OrderPageInput = z.infer<typeof orderPageInputSchema>;
export type OrderPageRequest = z.input<typeof orderPageInputSchema>;
export type OrderPageInfo = {
  before: string | null;
  after: string | null;
  hasOlder: boolean;
  hasNewer: boolean;
  source: string;
};
export type OrderConversationPage = TicketDetail & {
  page: OrderPageInfo;
  fingerprint: string;
  changed: boolean;
  updates: TicketDetailMessage[] | null;
  confirmedRequestIds: string[];
};

export function compareConversationTime(a: string, b: string) {
  return Date.parse(a) - Date.parse(b) ||
    (a.match(/\.(\d+)/)?.[1] ?? "").padEnd(6,"0").localeCompare((b.match(/\.(\d+)/)?.[1] ?? "").padEnd(6,"0"));
}

export function orderMessageCursor(orderId: string, source: string, direction: "before" | "after", message?: TicketDetailMessage) {
  return message ? JSON.stringify({ order: orderId, source, direction, at: message.created_at, id: message.id }) : null;
}

export function retainOrderTimeline(messages: TicketDetailMessage[], calls: CallHistoryEntry[], direction: "before" | "after", anchorId: string | null) {
  const pending = messages.filter(m => m.pending || m.failed);
  const entries = [
    ...new Map(messages.filter(m => !m.pending && !m.failed).map(message => [message.id,{kind:"message" as const,id:message.id,at:message.created_at,message}])).values(),
    ...new Map(calls.map(call => [call.id,{kind:"call" as const,id:call.id,at:call.requestedAt,call}])).values(),
  ].sort((a,b)=>compareConversationTime(a.at,b.at)||a.id.localeCompare(b.id)||a.kind.localeCompare(b.kind));
  let start = direction === "before" ? 0 : Math.max(0,entries.length-100);
  const anchor = entries.findIndex(entry=>entry.id===anchorId);
  if (anchor >= 0) start = Math.max(Math.min(start,anchor),anchor-99);
  const retained = entries.slice(start,start+100);
  return {
    messages: [...retained.flatMap(entry=>entry.kind==="message"?[entry.message]:[]),...pending],
    calls: retained.flatMap(entry=>entry.kind==="call"?[entry.call]:[]),
    evictedBefore: start>0,
    evictedAfter: start+100<entries.length,
  };
}
