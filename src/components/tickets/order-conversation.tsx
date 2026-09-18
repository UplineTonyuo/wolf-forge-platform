"use client";

import { useState, type ReactNode } from "react";
import type { TeamConversationView } from "../../domain/team/projections";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { TicketComposer } from "./ticket-composer";
import { TicketConversation } from "./ticket-conversation";
import { useOptimisticTicketMessages } from "./use-optimistic-ticket-messages";
import type { OrderReplyTarget } from "./order-message-actions";
import styles from "./tickets.module.css";

export function OrderConversation({
  orderId,
  heading,
  messages,
  viewerProfileId,
  destinations,
  canReply,
  repliesDisabled,
  headerActions,
}: {
  orderId: string;
  heading: string;
  messages: TicketDetailMessage[];
  viewerProfileId: string;
  destinations: TeamConversationView[];
  canReply: boolean;
  repliesDisabled: boolean;
  headerActions?: ReactNode;
}) {
  const [replyTo, setReplyTo] = useState<OrderReplyTarget | null>(null);
  const optimistic = useOptimisticTicketMessages(messages, { mode: "admin", viewerProfileId });

  return (
    <div className={styles.orderConversationSurface}>
      <TicketConversation
        orderChat
        viewerProfileId={viewerProfileId}
        messages={optimistic.messages}
        heading={heading}
        sourceLabel={heading}
        hideInternalNotes
        headerActions={headerActions}
        forwardDestinations={destinations}
        onReply={canReply && !repliesDisabled ? setReplyTo : undefined}
        canReact={canReply}
        onRetryMessage={(message) => void optimistic.retry(message.requestId ?? "")}
      />
      {canReply ? (
        <TicketComposer
          target={{ kind: "order", orderId }}
          mode="admin"
          disabled={repliesDisabled}
          attached
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          optimistic={{ onSend: optimistic.addOptimistic, onSettled: optimistic.settle }}
        />
      ) : null}
    </div>
  );
}
