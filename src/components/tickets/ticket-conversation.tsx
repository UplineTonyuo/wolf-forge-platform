import { FileText, LockKeyhole, MessageSquareText } from "lucide-react";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { formatDateTime } from "../../lib/format";
import { ticketActorLabel } from "../../lib/tickets/presentation";
import styles from "./tickets.module.css";

export function TicketConversation({ messages, clientView = false }: { messages: TicketDetailMessage[]; clientView?: boolean }) {
  return <section className={styles.conversation} aria-labelledby="conversation-heading">
    <header><div><MessageSquareText aria-hidden="true" /><div><h2 id="conversation-heading">Conversation</h2><p>{messages.length} {messages.length === 1 ? "message" : "messages"}</p></div></div></header>
    <ol className={styles.thread}>{messages.map((message) => {
      const note = message.visibility === "internal" || message.message_kind === "internal_note";
      if (clientView && note) return null;
      return <li key={message.id} className={note ? styles.internalMessage : styles.message}>
        <header><div><strong>{ticketActorLabel(message.author_type, message.author_name)}</strong>{note ? <span><LockKeyhole aria-hidden="true" /> Internal note</span> : null}</div><time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time></header>
        <p>{message.body}</p>
        {message.attachments.length ? <ul className={styles.attachments}>{message.attachments.map((attachment) => <li key={attachment.id}><FileText aria-hidden="true" /><span>{attachment.original_name}</span><small>Metadata only</small></li>)}</ul> : null}
      </li>;
    })}</ol>
  </section>;
}
