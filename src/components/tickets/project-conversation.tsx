"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toggleClientOrderMessageReactionAction } from "../../app/actions/tickets";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { TicketComposer } from "./ticket-composer";
import { TicketConversation } from "./ticket-conversation";
import { useOptimisticTicketMessages } from "./use-optimistic-ticket-messages";
import { useClientConversationPresence } from "./use-client-conversation-presence";
import type { OrderReplyTarget } from "./order-message-actions";

export function ProjectConversation({
  orderId,
  heading,
  messages,
  repliesDisabled,
}: {
  orderId: string;
  heading: string;
  messages: TicketDetailMessage[];
  repliesDisabled: boolean;
}) {
  const router = useRouter();
  const [replyTo, setReplyTo] = useState<OrderReplyTarget | null>(null);
  useClientConversationPresence("project", orderId);
  const optimistic = useOptimisticTicketMessages(messages, { mode: "client" });

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const poll = window.setInterval(refresh, 4_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  const toggleReaction = (messageId: string, reactionCode: string) =>
    toggleClientOrderMessageReactionAction(orderId, messageId, reactionCode);

  return (
    <>
      <TicketConversation
        messages={optimistic.messages}
        clientView
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
      />
    </>
  );
}
