"use client";

import { useState } from "react";
import { toggleClientOrderMessageReactionAction } from "../../app/actions/tickets";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { TicketComposer } from "./ticket-composer";
import { TicketConversation } from "./ticket-conversation";
import { useTicketConversationMessages } from "./use-ticket-conversation-messages";
import { useClientConversationPresence } from "./use-client-conversation-presence";
import type { OrderReplyTarget } from "./order-message-actions";

/**
 * The client Project conversation. It renders through the same `orderChat`
 * surface the internal Project conversation uses (no row dividers, message
 * spacing, other-party identity only), and resolves "my message" from the
 * signed-in profile id rather than from the client role, so the two POVs of
 * one Project run the same perspective rule and reverse cleanly.
 */
export function ProjectConversation({
  orderId,
  heading,
  messages,
  viewerProfileId,
  repliesDisabled,
}: {
  orderId: string;
  heading: string;
  messages: TicketDetailMessage[];
  viewerProfileId: string;
  repliesDisabled: boolean;
}) {
  const [replyTo, setReplyTo] = useState<OrderReplyTarget | null>(null);
  const optimistic = useTicketConversationMessages({ projectId: orderId, serverMessages: messages, mode: "client", viewerProfileId });
  useClientConversationPresence("project", orderId, !optimistic.unavailable);

  const toggleReaction = async (messageId: string, reactionCode: string) => {
    const result = await toggleClientOrderMessageReactionAction(orderId, messageId, reactionCode);
    if (result.ok) optimistic.wake();
    return result;
  };

  if (optimistic.unavailable) return <p role="alert">This conversation is unavailable.</p>;

  return (
    <>
      <TicketConversation
        orderChat
        clientView
        viewerProfileId={viewerProfileId}
        messages={optimistic.messages}
        heading={heading}
        onReply={repliesDisabled ? undefined : setReplyTo}
        canReact
        onToggleReaction={toggleReaction}
        onRetryMessage={(message) => void optimistic.retry(message.requestId ?? "")}
      />
      <TicketComposer
        target={{ kind: "order", orderId }}
        mode="client"
        disabled={repliesDisabled}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        optimistic={{ onSend: optimistic.addOptimistic, onSettled: optimistic.settle }}
        confirmedRequestIds={messages.filter((message) => message.requestId).map((message) => message.requestId!)}
      />
    </>
  );
}
