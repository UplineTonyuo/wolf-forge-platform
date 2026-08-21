import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ClientRecentMessage } from "../../../domain/client-portal/summary";
import { formatDateTime } from "../../../lib/format";
import styles from "./client-deck.module.css";

/**
 * Recent conversations, as an inbox stack.
 *
 * Rows on one surface rather than bordered cards, because a conversation list
 * is read by scanning subjects — the card chrome was competing with the only
 * thing anyone looks at.
 *
 * Two things this deliberately does NOT show:
 *
 *   unread state   public.ticket_messages has no per-recipient read state and
 *                  public.tickets has no last-seen column, so an unread dot
 *                  would be decoration. clientPortalUnreadIsSupported records
 *                  this; the honest signal is "waiting on you", which the
 *                  leading mark carries.
 *
 *   avatars        ClientRecentMessage carries no participant. An avatar here
 *                  would stand for nobody, so the neutral person fallback is
 *                  not used on this surface — it belongs where a real person is
 *                  identified, such as a ticket message author.
 */
function ConversationRow({
  message,
  index,
}: {
  message: ClientRecentMessage;
  index: number;
}) {
  return (
    <li
      className={styles.stackItem}
      style={{ "--wf-deck-index": index } as React.CSSProperties}
    >
      <Link href={message.href} className={styles.conversation} data-tone={message.tone}>
        <span className={styles.conversationMain}>
          <span className={styles.conversationTop}>
            <span className={styles.projectRef}>{message.reference}</span>
            <span className={styles.conversationSubject}>{message.subject}</span>
          </span>

          <span className={styles.projectMeta}>
            <span className={styles.projectState}>{message.toneLabel}</span>
            <span className={styles.metaDot} aria-hidden={true} />
            <span>
              {message.messageCount} {message.messageCount === 1 ? "message" : "messages"}
            </span>
            <span className={styles.metaDot} aria-hidden={true} />
            <span>updated {formatDateTime(message.activityAt)}</span>
          </span>
        </span>

        {/*
          * Present at rest and merely quieter, so the affordance is never
          * hover-only. It sharpens and shifts on hover and focus alike.
          */}
        <span className={styles.conversationOpen}>
          Open
          <ArrowRight aria-hidden={true} />
        </span>
      </Link>
    </li>
  );
}

export function RecentConversationsSection({
  messages,
}: {
  messages: ClientRecentMessage[];
}) {
  return (
    <section className={styles.section} aria-labelledby="portal-recent-messages">
      <header className="portal-section-head">
        <h2 id="portal-recent-messages">Recent conversations</h2>
        <Link className="portal-secondary-action" href="/account/messages">
          All messages
          <ArrowUpRight aria-hidden={true} />
        </Link>
      </header>

      {messages.length === 0 ? (
        <p className="portal-empty">
          No conversations yet. Start one whenever you need us and every reply stays here.
        </p>
      ) : (
        <ul className={styles.stack}>
          {messages.map((message, index) => (
            <ConversationRow key={message.id} message={message} index={index} />
          ))}
        </ul>
      )}
    </section>
  );
}
