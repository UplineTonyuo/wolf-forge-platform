"use client";

import { useState, type ReactNode } from "react";
import { toggleTicketMessageReactionAction } from "../../app/actions/tickets";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import type { TeamConversationView } from "../../domain/team/projections";
import type { OrderReplyTarget } from "./order-message-actions";
import { TicketComposer } from "./ticket-composer";
import { TicketConversation } from "./ticket-conversation";
import styles from "./tickets.module.css";
import { useTicketConversationMessages } from "./use-ticket-conversation-messages";

/**
 * The staff Ticket conversation.
 *
 * The Ticket detail page used to render `TicketConversation` bare, which meant
 * staff got the pre-chat feed rendering -- a divider between every message, an
 * avatar and name over every message including their own, and no message
 * actions at all -- while the client portal got the connected chat surface.
 * The same conversation looked like two different products depending on who
 * opened it.
 *
 * This is the staff half of the shared chat system: it reuses the same
 * `TicketConversation` primitives the Order/Project conversation and the client
 * portal use, with the viewer's own profile id so "my message" resolves to the
 * person actually signed in, and attaches the composer the same way.
 *
 * The transcript itself comes from `useTicketConversationMessages`, which owns
 * both the optimistic layer and the live lane — so a message from the client
 * appears here without a reload, and a local send is confirmed by the same
 * reconcile the other side gets.
 */
export function TicketAdminConversation({
  ticketId,
  heading,
  messages,
  viewerProfileId,
  destinations,
  canReply,
  canReact,
  repliesDisabled,
  headerActions,
  contactName = null,
}: {
  ticketId: string;
  heading: ReactNode;
  messages: TicketDetailMessage[];
  viewerProfileId: string;
  destinations: TeamConversationView[];
  canReply: boolean;
  canReact: boolean;
  repliesDisabled: boolean;
  headerActions?: ReactNode;
  /** Ticket's client/contact display name, for the composer's placeholder. */
  contactName?: string | null;
}) {
  const [replyTo, setReplyTo] = useState<OrderReplyTarget | null>(null);
  const conversation = useTicketConversationMessages({
    ticketId,
    serverMessages: messages,
    mode: "admin",
    viewerProfileId,
  });

  /* A local reaction wakes the lane too, so the two views converge on the
     same authoritative aggregate rather than each trusting its own click. */
  const toggleReaction = async (messageId: string, reactionCode: string) => {
    const result = await toggleTicketMessageReactionAction(messageId, reactionCode);
    if (result.ok) conversation.wake();
    return result;
  };

  return (
    <div className={`${styles.orderConversationSurface} ${styles.ticketAdminSurface} ticket-admin-surface-marker`}>
      <TicketConversation
        orderChat
        viewerProfileId={viewerProfileId}
        messages={conversation.messages}
        heading={heading}
        sourceLabel="Ticket"
        hideInternalNotes
        headerActions={headerActions}
        forwardDestinations={destinations}
        onReply={canReply && !repliesDisabled ? setReplyTo : undefined}
        canReact={canReact}
        onToggleReaction={toggleReaction}
        onRetryMessage={(message) => void conversation.retry(message.requestId ?? "")}
      />
      {canReply ? (
        <TicketComposer
          target={{ kind: "ticket", ticketId }}
          mode="admin"
          disabled={repliesDisabled}
          attached
          compact
          contactName={contactName}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          optimistic={{
            onSend: conversation.addOptimistic,
            onSettled: conversation.settle,
          }}
        />
      ) : null}
    </div>
  );
}
