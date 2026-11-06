"use client";

import { useState, type ReactNode } from "react";
import { toggleOrderMessageReactionAction } from "../../app/actions/tickets";
import type { TeamConversationView } from "../../domain/team/projections";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { TicketComposer } from "./ticket-composer";
import { TicketConversation } from "./ticket-conversation";
import { useOptimisticTicketMessages } from "./use-optimistic-ticket-messages";
import type { OrderReplyTarget } from "./order-message-actions";
import styles from "./tickets.module.css";
import { OrderCallControls } from "./ticket-call-controls";
import { useTicketCallHistory } from "./use-ticket-call-history";

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
  const history = useTicketCallHistory(orderId, true);
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
        callControls={<OrderCallControls orderId={orderId} disabled={!canReply || repliesDisabled} />}
        callHistory={history.entries}
        historyControls={history.error ? <p role="status">{history.error} {history.retryable ? <button type="button" disabled={history.busy} onClick={() => void history.load()}>Retry call history</button> : null}</p> : history.more ? <button type="button" disabled={history.busy} onClick={() => void history.load(true)}>Earlier calls</button> : null}
        forwardDestinations={destinations}
        onReply={canReply && !repliesDisabled ? setReplyTo : undefined}
        canReact={canReply}
        onToggleReaction={(messageId, reactionCode) =>
          toggleOrderMessageReactionAction(orderId, messageId, reactionCode)
        }
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
