"use client";

import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { TicketComposer } from "./ticket-composer";
import { TicketConversation } from "./ticket-conversation";
import { useOptimisticTicketMessages } from "./use-optimistic-ticket-messages";

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
  const optimistic = useOptimisticTicketMessages(messages, { mode: "client" });

  return (
    <>
      <TicketConversation
        messages={optimistic.messages}
        clientView
        heading={heading}
        onRetryMessage={(message) => void optimistic.retry(message.requestId ?? "")}
      />
      <TicketComposer
        target={{ kind: "order", orderId }}
        mode="client"
        disabled={repliesDisabled}
        optimistic={{ onSend: optimistic.addOptimistic, onSettled: optimistic.settle }}
      />
    </>
  );
}
