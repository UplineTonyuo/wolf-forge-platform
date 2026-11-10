"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { ArrowDown, History } from "lucide-react";
import { TicketConversation } from "./ticket-conversation";
import type { useOrderConversationMessages } from "./use-order-conversation-messages";
import styles from "./tickets.module.css";

type Conversation = ReturnType<typeof useOrderConversationMessages>;
export function OrderConversationPanel({conversation,renderer,children}:{conversation:Conversation;renderer:Omit<ComponentProps<typeof TicketConversation>,"messages"|"transcript"|"callHistory">;children:ReactNode}) {
  const scroll=useRef<HTMLDivElement>(null);
  const host=useRef<HTMLDivElement>(null);
  const anchor=useRef<{id:string;offset:number}|null>(null);
  const following=useRef(true),latest=useRef(conversation.latestRevision),initialized=useRef(false);
  const viewport=useRef(conversation.setViewport);
  useLayoutEffect(()=>{viewport.current=conversation.setViewport},[conversation.setViewport]);
  useLayoutEffect(()=>{
    const viewport=window.visualViewport;
    const resize=()=>{host.current?.style.setProperty("--order-viewport-height",`${viewport?.height??window.innerHeight}px`)};
    resize();viewport?.addEventListener("resize",resize);window.addEventListener("resize",resize);
    return ()=>{viewport?.removeEventListener("resize",resize);window.removeEventListener("resize",resize)};
  },[]);
  const capture=useCallback(()=>{
    const element=scroll.current;if(!element)return;
    // Follow only within 60 CSS pixels of the bottom, including keyboard scrolling.
    const near=element.scrollHeight-element.clientHeight-element.scrollTop<=60;
    following.current=near;
    const top=element.getBoundingClientRect().top;
    const focused=document.activeElement?.closest<HTMLElement>("[data-timeline-id]");
    const node=focused&&element.contains(focused)?focused:Array.from(element.querySelectorAll<HTMLElement>("[data-timeline-id]")).find(node=>node.getBoundingClientRect().bottom>top);
    anchor.current=node?{id:node.dataset.timelineId!,offset:node.getBoundingClientRect().top-top}:null;
    viewport.current(near,anchor.current?.id??null);
  },[]);
  useLayoutEffect(()=>{
    const element=scroll.current;if(!element)return;
    const restore=()=>{
      if(!initialized.current||following.current||latest.current!==conversation.latestRevision){
        element.scrollTop=element.scrollHeight;following.current=true;latest.current=conversation.latestRevision;initialized.current=true;
      }else if(anchor.current){
        const saved=anchor.current;
        const node=Array.from(element.querySelectorAll<HTMLElement>("[data-timeline-id]")).find(node=>node.dataset.timelineId===saved.id);
        if(node)element.scrollTop+=node.getBoundingClientRect().top-element.getBoundingClientRect().top-saved.offset;
      }
    };
    restore();
    const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(restore);
    if(element.firstElementChild)observer?.observe(element.firstElementChild);
    const list=element.querySelector("ol");if(list)observer?.observe(list);
    return ()=>observer?.disconnect();
  },[conversation.messages,conversation.calls,conversation.latestRevision]);
  return <div ref={host} className={`${styles.orderConversationSurface} ${styles.orderPagedSurface}`} data-order-conversation="paged">
    <TicketConversation {...renderer} orderChat messages={conversation.messages} callHistory={conversation.calls}
      transcript={{ref:scroll,onScroll:capture,controls:<div className={styles.messageHistoryBar}>
        {conversation.page.hasOlder?<button type="button" disabled={conversation.busy} onClick={()=>{capture();following.current=false;conversation.setViewport(false,anchor.current?.id??null);void conversation.loadOlder()}}><History aria-hidden="true"/>{conversation.busy?"Loading messages…":"Load 10 older messages"}</button>:<span>Beginning of conversation</span>}
        <span>{conversation.messages.filter(m=>!m.pending&&!m.failed).length} messages loaded</span>
        {conversation.error?<p role="status">{conversation.error} <button type="button" disabled={conversation.busy} onClick={()=>void conversation.retryPage()}>Retry messages</button></p>:null}
      </div>,jump:conversation.away||conversation.newCount||conversation.page.hasNewer?<div className={styles.jumpLatest}>
        {conversation.page.hasNewer?<button type="button" disabled={conversation.busy} onClick={()=>void conversation.loadNewer()}>Load 10 newer messages</button>:null}
        <button type="button" disabled={conversation.busy} onClick={()=>void conversation.jumpToLatest()}><ArrowDown aria-hidden="true"/>{conversation.newCount?`${conversation.newCount}${conversation.newCountMinimum?"+":""} new messages · `:""}Jump to latest</button>
      </div>:null}}/>
    {children}
    <span role="status" aria-live="polite" className="sr-only">{conversation.newCount?`${conversation.newCount}${conversation.newCountMinimum?" or more":""} new messages`:conversation.busy?"Loading message history":""}</span>
  </div>;
}
