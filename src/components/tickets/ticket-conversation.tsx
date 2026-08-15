import type { ReactNode } from "react";
import { FileText, LockKeyhole, MessageSquareText } from "lucide-react";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { formatDateTime } from "../../lib/format";
import { ticketActorLabel } from "../../lib/tickets/presentation";
import styles from "./tickets.module.css";

function renderTicketInline(
  text: string,
): ReactNode[] {
  const tokenPattern =
    /(\*\*[^*\n]+\*\*|_[^_\n]+_|\[[^\]\n]+\]\((?:https?:\/\/|mailto:|tel:)[^)\s]+\))/g;

  return text
    .split(tokenPattern)
    .filter(
      (part) =>
        part.length > 0,
    )
    .map(
      (part, index) => {

        if (
          part.startsWith("**") &&
          part.endsWith("**")
        ) {
          return (
            <strong key={index}>
              {renderTicketInline(part.slice(2, -2))}
            </strong>
          );
        }


        if (
          part.startsWith("_") &&
          part.endsWith("_")
        ) {
          return (
            <em key={index}>
              {renderTicketInline(part.slice(1, -1))}
            </em>
          );
        }


        const link =
          part.match(
            /^\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)]+)\)$/,
          );


        if (link) {
          const href =
            link[2] ?? "";

          const external =
            href.startsWith("http://") ||
            href.startsWith("https://");

          return (
            <a
              key={index}
              href={href}
              target={
                external
                  ? "_blank"
                  : undefined
              }
              rel={
                external
                  ? "noreferrer noopener"
                  : undefined
              }
            >
              {link[1]}
            </a>
          );
        }


        return (
          <span key={index}>
            {part}
          </span>
        );
      },
    );
}


function TicketMessageBody({
  body,
}: {
  body: string;
}) {
  return (
    <div className={styles.messageBody}>
      {body
        .split("\n")
        .map(
          (line, index) => {

            if (
              line.startsWith("# ")
            ) {
              return (
                <h3 key={index}>
                  {renderTicketInline(
                    line.slice(2),
                  )}
                </h3>
              );
            }


            return (
              <p key={index}>
                {line
                  ? renderTicketInline(
                      line,
                    )
                  : <br />}
              </p>
            );
          },
        )}
    </div>
  );
}

export function TicketConversation({ messages, clientView = false }: { messages: TicketDetailMessage[]; clientView?: boolean }) {
  return <section className={styles.conversation} aria-labelledby="conversation-heading">
    <header><div><MessageSquareText aria-hidden="true" /><div><h2 id="conversation-heading">Conversation</h2><p>{messages.length} {messages.length === 1 ? "message" : "messages"}</p></div></div></header>
    <ol className={styles.thread}>{messages.map((message) => {
      const note = message.visibility === "internal" || message.message_kind === "internal_note";
      if (clientView && note) return null;
      return <li key={message.id} className={note ? styles.internalMessage : styles.message}>
        <header><div><strong>{ticketActorLabel(message.author_type, message.author_name)}</strong>{note ? <span><LockKeyhole aria-hidden="true" /> Internal note</span> : null}</div><time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time></header>
        <TicketMessageBody body={message.body} />
        {message.attachments.length ? <ul className={styles.attachments}>{message.attachments.map((attachment) => <li key={attachment.id}><FileText aria-hidden="true" /><span>{attachment.original_name}</span><small>Metadata only</small></li>)}</ul> : null}
      </li>;
    })}</ol>
  </section>;
}
