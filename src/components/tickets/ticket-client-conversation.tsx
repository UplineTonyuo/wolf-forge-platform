"use client";

import { useState } from "react";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { toggleClientTicketMessageReactionAction } from "../../app/actions/tickets";
import type { OrderReplyTarget } from "./order-message-actions";
import { TicketComposer } from "./ticket-composer";
import { TicketCallControls } from "./ticket-call-controls";
import { TicketConversation } from "./ticket-conversation";
import styles from "./tickets.module.css";
import { useTicketConversationMessages } from "./use-ticket-conversation-messages";
import { useClientConversationPresence } from "./use-client-conversation-presence";
import { useTicketUnavailableBoundary } from "./ticket-access-boundary";
import { useTicketCallHistory } from "./use-ticket-call-history";

/**
 * The client Ticket conversation — the same chat surface as the staff one
 * (`orderChat`, no dividers, identity only on the other party, optimistic
 * sends), plus the Reply state Ticket client messages need.
 *
 * The client gets exactly three actions: Reply, React and Copy. `React` goes
 * through `toggleClientTicketMessageReactionAction`, which reaches the SAME
 * `app_toggle_ticket_message_reaction` RPC the staff action uses from the
 * client's own authorized context — reactions are shared conversation state
 * on both sides, never a local toggle.
 *
 * There is deliberately no `forwardDestinations`: Forward is a staff workflow
 * (`forwardTicketMessageToTeamAction` requires `tickets.view` plus Team
 * access), so the client is given no Forward entry rather than one that would
 * fail. Internal notes never reach a client at all — `app_get_ticket_detail`
 * refuses them to a client actor inside Postgres, so they are not in the
 * transcript this component is handed, live lane included.
 *
 * The transcript comes from `useTicketConversationMessages`, so a reply or
 * reaction from staff arrives here without a reload.
 */
export function TicketClientConversation({
  ticketId,
  messages,
  viewerProfileId,
  repliesDisabled,
}: {
  ticketId: string;
  messages: TicketDetailMessage[];
  /** The signed-in client's profile id: ownership comes from the
   *  authenticated user, not from the client role. */
  viewerProfileId: string;
  repliesDisabled: boolean;
}) {
  const [replyTo, setReplyTo] = useState<OrderReplyTarget | null>(null);
  const history = useTicketCallHistory(ticketId);
  const onUnavailable = useTicketUnavailableBoundary();
  const conversation = useTicketConversationMessages({
    ticketId,
    serverMessages: messages,
    mode: "client",
    viewerProfileId,
    onUnavailable,
  });
  useClientConversationPresence("ticket", ticketId, !conversation.unavailable);

  /* A local reaction wakes the lane too, so the two views converge on the
     same authoritative aggregate rather than each trusting its own click. */
  const toggleReaction = async (messageId: string, reactionCode: string) => {
    const result = await toggleClientTicketMessageReactionAction(messageId, reactionCode);
    if (result.ok) conversation.wake();
    return result;
  };

  if (conversation.unavailable) return <p role="alert">This conversation is unavailable.</p>;

  return (
    <div className={styles.orderConversationSurface}>
      <TicketConversation
        orderChat
        clientView
        callControls={<TicketCallControls ticketId={ticketId} disabled={repliesDisabled} />}
        sourceLabel="Ticket"
        viewerProfileId={viewerProfileId}
        messages={conversation.messages}
        callHistory={history.entries}
        historyControls={history.error ? <p role="status">{history.error} <button type="button" onClick={() => void history.load()}>Retry call history</button></p> : history.more ? <button type="button" disabled={history.busy} onClick={() => void history.load(true)}>Earlier calls</button> : null}
        onReply={repliesDisabled ? undefined : setReplyTo}
        canReact
        onToggleReaction={toggleReaction}
        onRetryMessage={(message) => void conversation.retry(message.requestId ?? "")}
      />
      <TicketComposer
        target={{ kind: "ticket", ticketId }}
        mode="client"
        disabled={repliesDisabled}
        attached
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        optimistic={{
          onSend: conversation.addOptimistic,
          onSettled: conversation.settle,
        }}
        confirmedRequestIds={conversation.messages.filter((message) => !message.pending && message.requestId).map((message) => message.requestId!)}
      />
    </div>
  );
}
