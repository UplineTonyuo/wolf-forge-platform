import { Phone, PhoneMissed, Video } from "lucide-react";
import type { CallHistoryEntry } from "../../domain/tickets/calls";
import { formatDateTime } from "../../lib/format";
import styles from "./tickets.module.css";

function outcome(call: CallHistoryEntry) {
  if (call.state !== "ended") return call.state === "ringing" ? "Ringing" : call.state === "active" ? "In progress" : "Connecting";
  if (call.outcome === "missed") return "Missed";
  if (call.outcome === "declined") return "Declined";
  if (!call.answeredAt && call.reason === "participant_ended") return "Canceled";
  if (call.outcome === "busy") return "Busy";
  if (call.outcome === "refused") return "Unavailable";
  return call.answeredAt || call.outcome === "answered" ? "Ended" : "Expired";
}
export function TicketCallHistoryEntry({ call, timeZone }: { call: CallHistoryEntry; timeZone: string | undefined }) {
  const Icon = call.outcome === "missed" ? PhoneMissed : call.mode === "video" ? Video : Phone;
  return <li className={styles.callHistoryEntry} data-call-id={call.id}>
    <Icon aria-hidden="true" />
    <div><strong>{outcome(call)} {call.mode === "audio" ? "voice" : "video"} call</strong>
      <span>{call.caller.name} → {call.callee?.name ?? "No recipient"}</span>
      <time dateTime={call.requestedAt}>{formatDateTime(call.requestedAt, timeZone)}</time>
    </div>
  </li>;
}
