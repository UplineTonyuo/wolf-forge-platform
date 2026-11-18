"use client";

import { useContext, useEffect, useState, type ReactNode } from "react";
import { OrderHeaderSlot } from "./order-conversation-dialog";
import { toggleOrderMessageReactionAction } from "../../app/actions/tickets";
import type { TeamConversationView } from "../../domain/team/projections";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { TicketComposer } from "./ticket-composer";
import { OrderConversationPanel } from "./order-conversation-panel";
import { useOrderConversationMessages } from "./use-order-conversation-messages";
import type { OrderPageInfo } from "../../domain/orders/conversation-page";
import type { OrderReplyTarget } from "./order-message-actions";
import { OrderCallControls } from "./ticket-call-controls";
import { useTicketCallHistory } from "./use-ticket-call-history";

function OrderConversationBody({
  orderId,
  heading,
  messages,
  viewerProfileId,
  destinations,
  canReply,
  repliesDisabled,
  headerActions,
  initialPage,
}: {
  orderId: string;
  heading: string;
  messages: TicketDetailMessage[];
  viewerProfileId: string;
  destinations: TeamConversationView[];
  canReply: boolean;
  repliesDisabled: boolean;
  headerActions?: ReactNode;
  initialPage?: OrderPageInfo;
}) {
  const [replyTo, setReplyTo] = useState<OrderReplyTarget | null>(null);
  const headerSlot = useContext(OrderHeaderSlot);
  const optimistic = useOrderConversationMessages({orderId,serverMessages:messages,initialPage,mode:"admin",viewerProfileId});
  const history = useTicketCallHistory(orderId, true,{entries:optimistic.calls,onPage:optimistic.addCalls,onClear:optimistic.clearCalls,resetKey:optimistic.latestRevision});
  useEffect(()=>{if(optimistic.unavailable)queueMicrotask(()=>setReplyTo(null))},[optimistic.unavailable]);
  if(optimistic.unavailable)return <p role="alert">This conversation is unavailable.</p>;

  return (
    <OrderConversationPanel conversation={optimistic} renderer={{viewerProfileId,heading,sourceLabel:heading,hideInternalNotes:true,headerActions,headerSlot,
      callControls:<OrderCallControls orderId={orderId} disabled={!canReply||repliesDisabled}/>,
      historyControls:history.error?<p role="status">{history.error} {history.retryable?<button type="button" disabled={history.busy} onClick={()=>void history.load()}>Retry call history</button>:null}</p>:history.more||optimistic.hasEvictedEarlierCalls?<button type="button" disabled={history.busy} onClick={()=>void history.load(true)}>Earlier calls</button>:null,
      forwardDestinations:destinations,onReply:canReply&&!repliesDisabled?setReplyTo:undefined,canReact:canReply,
      onToggleReaction:async(messageId,reactionCode)=>{const result=await toggleOrderMessageReactionAction(orderId,messageId,reactionCode);if(result.ok)optimistic.wake();return result},
      onRetryMessage:message=>void optimistic.retry(message.requestId??"")}}>
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
    </OrderConversationPanel>
  );
}

export function OrderConversation(props:Parameters<typeof OrderConversationBody>[0]) {
  return <OrderConversationBody key={`${props.orderId}:${props.viewerProfileId}:${props.initialPage?.source??""}`} {...props}/>;
}
