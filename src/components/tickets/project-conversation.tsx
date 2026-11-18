"use client";

import { useContext, useEffect, useState } from "react";
import { OrderConversationVisible, OrderHeaderSlot } from "./order-conversation-dialog";
import { toggleClientOrderMessageReactionAction } from "../../app/actions/tickets";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { TicketComposer } from "./ticket-composer";
import { OrderConversationPanel } from "./order-conversation-panel";
import { useOrderConversationMessages } from "./use-order-conversation-messages";
import type { OrderPageInfo } from "../../domain/orders/conversation-page";
import { useClientConversationPresence } from "./use-client-conversation-presence";
import type { OrderReplyTarget } from "./order-message-actions";
import { OrderCallControls } from "./ticket-call-controls";
import { useTicketCallHistory } from "./use-ticket-call-history";

/**
 * The client Project conversation. It renders through the same `orderChat`
 * surface the internal Project conversation uses (no row dividers, message
 * spacing, other-party identity only), and resolves "my message" from the
 * signed-in profile id rather than from the client role, so the two POVs of
 * one Project run the same perspective rule and reverse cleanly.
 */
function ProjectConversationBody({
  orderId,
  heading,
  messages,
  viewerProfileId,
  repliesDisabled,
  initialPage,
}: {
  orderId: string;
  heading: string;
  messages: TicketDetailMessage[];
  viewerProfileId: string;
  repliesDisabled: boolean;
  initialPage?: OrderPageInfo;
}) {
  const [replyTo, setReplyTo] = useState<OrderReplyTarget | null>(null);
  const visible = useContext(OrderConversationVisible);
  const headerSlot = useContext(OrderHeaderSlot);
  const optimistic = useOrderConversationMessages({orderId,serverMessages:messages,initialPage,mode:"client",viewerProfileId});
  const history = useTicketCallHistory(orderId,true,{entries:optimistic.calls,onPage:optimistic.addCalls,onClear:optimistic.clearCalls,resetKey:optimistic.latestRevision});
  useEffect(()=>{if(optimistic.unavailable)queueMicrotask(()=>setReplyTo(null))},[optimistic.unavailable]);
  useClientConversationPresence("project", orderId, visible && !optimistic.unavailable);

  const toggleReaction = async (messageId: string, reactionCode: string) => {
    const result = await toggleClientOrderMessageReactionAction(orderId, messageId, reactionCode);
    if (result.ok) optimistic.wake();
    else if (result.code && ["PERMISSION_DENIED", "NOT_FOUND", "UNAUTHENTICATED"].includes(result.code)) optimistic.invalidate();
    return result;
  };

  if (optimistic.unavailable) return <p role="alert">This conversation is unavailable.</p>;

  return (
    <OrderConversationPanel conversation={optimistic} renderer={{clientView:true,viewerProfileId,heading,headerSlot,
      callControls:<OrderCallControls orderId={orderId} disabled={repliesDisabled}/>,
      historyControls:history.error?<p role="status">{history.error} {history.retryable?<button type="button" disabled={history.busy} onClick={()=>void history.load()}>Retry call history</button>:null}</p>:history.more||optimistic.hasEvictedEarlierCalls?<button type="button" disabled={history.busy} onClick={()=>void history.load(true)}>Earlier calls</button>:null,
      onReply:repliesDisabled?undefined:setReplyTo,canReact:true,onToggleReaction:toggleReaction,onRetryMessage:message=>void optimistic.retry(message.requestId??"")}}>
      <TicketComposer
        target={{ kind: "order", orderId }}
        mode="client"
        disabled={repliesDisabled}
        attached
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        optimistic={{ onSend: optimistic.addOptimistic, onSettled: optimistic.settle }}
        confirmedRequestIds={messages.filter((message) => message.requestId).map((message) => message.requestId!)}
      />
    </OrderConversationPanel>
  );
}

export function ProjectConversation(props:Parameters<typeof ProjectConversationBody>[0]) {
  return <ProjectConversationBody key={`${props.orderId}:${props.viewerProfileId}:${props.initialPage?.source??""}`} {...props}/>;
}
