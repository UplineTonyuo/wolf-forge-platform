"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compareConversationTime, orderMessageCursor, retainOrderTimeline, type OrderPageInfo } from "../../domain/orders/conversation-page";
import type { CallHistoryEntry } from "../../domain/tickets/calls";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { useTicketLiveSync } from "./use-ticket-live-sync";
import { useOptimisticTicketMessages } from "./use-optimistic-ticket-messages";

type State = { key: string; messages: TicketDetailMessage[]; calls: CallHistoryEntry[]; page: OrderPageInfo; fingerprint: string;
  newCount: number; newCountMinimum: boolean; error: string; busy: boolean; unavailable: boolean; latestRevision: number; oldestCall: {id:string;at:string}|null };
type PageData = { messages: TicketDetailMessage[]; updates?: TicketDetailMessage[] | null; page?: OrderPageInfo; fingerprint: string; confirmedRequestIds?: string[] };
const merge = (previous: TicketDetailMessage[], incoming: TicketDetailMessage[]) => [...new Map([...previous,...incoming].map(m=>[m.id,m])).values()]
  .sort((a,b)=>compareConversationTime(a.created_at,b.created_at)||a.id.localeCompare(b.id));
const messageKey=(message?:TicketDetailMessage)=>message?{id:message.id,created_at:message.created_at}:undefined;

export function useOrderConversationMessages({orderId,serverMessages,initialPage,mode,viewerProfileId}: {
  orderId:string;serverMessages:TicketDetailMessage[];initialPage?:OrderPageInfo;mode:"admin"|"client";viewerProfileId:string;
}) {
  const router=useRouter();
  const key=`${orderId}:${viewerProfileId}`;
  const seed:State={key,messages:serverMessages,calls:[],page:initialPage??{before:null,after:null,hasOlder:false,hasNewer:false,source:`project:${orderId}`},
    fingerprint:"",newCount:0,newCountMinimum:false,error:"",busy:false,unavailable:false,latestRevision:0,oldestCall:null};
  const [state,setState]=useState(seed);
  const [away,setAway]=useState(false);
  const current=useRef(state),generation=useRef(0),revision=useRef(0),liveRevision=useRef(0);
  const reading=useRef({nearBottom:true,anchor:null as string|null});
  const direct=useRef<AbortController|null>(null),busy=useRef(false);
  const observed=useRef(messageKey(serverMessages.at(-1)));
  const jumpRef=useRef<()=>void>(()=>{});
  const requestIds=useRef<string[]>([]),confirm=useRef<(ids:string[])=>void>(()=>{}),clear=useRef(()=>{});
  const pendingLatest=useRef(false),retryDirection=useRef<"before"|"after"|"latest">("before");
  const commit=useCallback((update:(previous:State)=>State)=>{
    const next=update(current.current);current.current=next;revision.current+=1;setState(next);
  },[]);
  useEffect(()=>{
    const epoch=++generation.current;
    current.current=seed;observed.current=messageKey(serverMessages.at(-1));revision.current+=1;busy.current=false;
    clear.current();requestIds.current=[];
    reading.current={nearBottom:true,anchor:null};
    queueMicrotask(()=>{if(generation.current===epoch){setState(current.current);setAway(false)}});
    return ()=>{generation.current+=1;direct.current?.abort()};
    // Protected state is scoped to the verified viewer and resource. New RSC arrays only wake the bounded lane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);

  const bound=useCallback((previous:State,messages:TicketDetailMessage[],calls:CallHistoryEntry[],direction:"before"|"after",page:OrderPageInfo)=>{
    const window=retainOrderTimeline(messages,calls,direction,reading.current.nearBottom?null:reading.current.anchor);
    return {...previous,messages:window.messages,calls:window.calls,page:{...page,
      before:orderMessageCursor(orderId,page.source,"before",window.messages[0])??page.before,
      after:orderMessageCursor(orderId,page.source,"after",window.messages.at(-1))??page.after,
      hasOlder:page.hasOlder||window.evictedBefore,hasNewer:page.hasNewer||window.evictedAfter}};
  },[orderId]);
  const deny=useCallback(()=>{
    direct.current?.abort();generation.current+=1;
    clear.current();requestIds.current=[];
    commit(previous=>({...previous,messages:[],calls:[],oldestCall:null,unavailable:true,newCount:0,busy:false}));router.refresh();
  },[commit,router]);
  const receive=useCallback((incoming:unknown[],fingerprint:string,data?:Record<string,unknown>)=>{
    if(liveRevision.current!==revision.current||current.current.key!==key||current.current.unavailable)return false;
    confirm.current((data?.confirmedRequestIds as string[]|undefined)??[]);
    const messages=incoming as TicketDetailMessage[];
    const page=(data?.page as OrderPageInfo|undefined)??current.current.page;
    const updates=(data?.updates as TicketDetailMessage[]|null)??[];
    const latest=messages.at(-1),seen=observed.current;
    if(latest&&seen&&(compareConversationTime(latest.created_at,seen.created_at)||latest.id.localeCompare(seen.id))<0)return false;
    const arrivals=seen?messages.filter(m=>(compareConversationTime(m.created_at,seen.created_at)||m.id.localeCompare(seen.id))>0):messages;
    const gap=Boolean(seen&&messages.length===10&&!messages.some(m=>m.id===seen.id)&&arrivals.length===10);
    observed.current=messageKey(latest)??seen;
    commit(previous=>{
      const replaced=merge(previous.messages,updates.filter(m=>previous.messages.some(old=>old.id===m.id)));
      const overlap=messages.some(m=>previous.messages.some(old=>old.id===m.id));
      const follow=reading.current.nearBottom&&!previous.page.hasNewer;
      const next=follow?bound(previous,overlap?merge(replaced,messages):messages,previous.calls,"after",
        {...page,hasOlder:page.hasOlder||overlap&&previous.page.hasOlder}):{...previous,messages:replaced};
      return {...next,fingerprint,newCount:follow?0:previous.newCount+arrivals.length,
        newCountMinimum:follow?false:previous.newCountMinimum||gap,error:""};
    });return true;
  },[bound,commit,key]);
  const {wake}=useTicketLiveSync({projectId:orderId,active:state.key===key&&!state.unavailable,
    getFingerprint:()=>current.current.fingerprint,
    getPageRequest:()=>{liveRevision.current=revision.current;return {page:{direction:"refresh",retainedIds:current.current.messages.filter(m=>!m.pending&&!m.failed).map(m=>m.id),requestIds:requestIds.current.slice(0,100)}}},
    onMessages:receive,onUnavailable:deny});
  const previousServer=useRef(serverMessages);
  useEffect(()=>{
    if(previousServer.current===serverMessages)return;
    previousServer.current=serverMessages;
    const retained=new Map(current.current.messages.map(message=>[message.id,message]));
    const latest=serverMessages.map(message=>retained.get(message.id)??message);
    if(latest.some(message=>!retained.has(message.id))){
      liveRevision.current=revision.current;
      receive(latest,"",{page:initialPage??current.current.page});
    }
    wake();
  },[serverMessages,initialPage,receive,wake]);

  const load=useCallback(async(direction:"before"|"after"|"latest")=>{
    if(current.current.unavailable||current.current.key!==key)return;
    if(busy.current){if(direction==="latest")pendingLatest.current=true;return}
    const cursor=direction==="before"?current.current.page.before:direction==="after"?current.current.page.after:null;
    if(direction!=="latest"&&!cursor)return;
    retryDirection.current=direction;
    if(direction==="before")reading.current={nearBottom:false,anchor:reading.current.anchor??current.current.messages.at(-1)?.id??null};
    busy.current=true;const epoch=generation.current;const controller=new AbortController();direct.current=controller;
    const timeout=setTimeout(()=>controller.abort(),15000);
    commit(previous=>({...previous,busy:true,error:""}));
    const requestRevision=revision.current;
    try{
      const response=await fetch("/api/ticket-live",{method:"POST",credentials:"same-origin",cache:"no-store",signal:controller.signal,
        headers:{"content-type":"application/json"},body:JSON.stringify({order_id:orderId,fingerprint:null,page:{direction,...(cursor?{cursor}:{})}})});
      const payload=await response.json();
      if(epoch!==generation.current||controller.signal.aborted)return;
      if([401,403,404].includes(response.status)){deny();return}
      if(!response.ok||!payload?.ok||payload.data?.orderId!==orderId||!Array.isArray(payload.data.messages))throw new Error("page");
      if(direction==="latest"&&requestRevision!==revision.current){
        pendingLatest.current=true;commit(previous=>({...previous,busy:false}));return;
      }
      const data=payload.data as PageData;
      confirm.current(data.confirmedRequestIds??[]);
      if(data.messages.length>10)throw new Error("page");
      const page=data.page??current.current.page;
      if(direction==="latest"){reading.current={nearBottom:true,anchor:null};setAway(false);observed.current=messageKey(data.messages.at(-1))}
      commit(previous=>{
        const next=bound(previous,direction==="latest"?data.messages:merge(previous.messages,data.messages),direction==="latest"?[]:previous.calls,direction==="before"?"before":"after",
          direction==="latest"?page:direction==="before"?{...previous.page,hasOlder:page.hasOlder}:{...previous.page,hasNewer:page.hasNewer});
        return {...next,oldestCall:direction==="latest"?null:previous.oldestCall,busy:false,error:"",fingerprint:"",newCount:direction==="latest"?0:previous.newCount,
          newCountMinimum:direction==="latest"?false:previous.newCountMinimum,latestRevision:previous.latestRevision+(direction==="latest"?1:0)};
      });
    }catch{
      if(epoch===generation.current)commit(previous=>({...previous,busy:false,error:"Message history could not be loaded. Try again."}));
    }finally{clearTimeout(timeout);if(epoch===generation.current){busy.current=false;direct.current=null;if(pendingLatest.current){pendingLatest.current=false;jumpRef.current()}}}
  },[bound,commit,deny,key,orderId]);
  const jumpToLatest=useCallback(()=>load("latest"),[load]);
  useEffect(()=>{jumpRef.current=()=>{void jumpToLatest()}},[jumpToLatest]);
  const optimistic=useOptimisticTicketMessages(state.key===key&&!state.unavailable?state.messages:[],{mode,viewerProfileId,confirmation:"request-id",onRetryAccepted:()=>jumpRef.current()});
  useEffect(()=>{requestIds.current=optimistic.pendingRequestIds;confirm.current=optimistic.confirm;clear.current=optimistic.clear},[optimistic.pendingRequestIds,optimistic.confirm,optimistic.clear]);
  const settle=(id:string,ok:boolean)=>{optimistic.settle(id,ok);if(ok){void jumpToLatest();wake()}};
  const setViewport=useCallback((nearBottom:boolean,anchor:string|null)=>{reading.current={nearBottom,anchor};setAway(!nearBottom)},[]);
  const addCalls=useCallback((calls:CallHistoryEntry[],older:boolean)=>{
    commit(previous=>{
      const oldest=calls.reduce((oldest,call)=>!oldest||(compareConversationTime(call.requestedAt,oldest.at)||call.id.localeCompare(oldest.id))<0?{id:call.id,at:call.requestedAt}:oldest,previous.oldestCall);
      return {...bound(previous,previous.messages,[...new Map([...previous.calls,...calls].map(c=>[c.id,c])).values()],older?"before":"after",previous.page),oldestCall:oldest};
    });
  },[bound,commit]);
  const clearCalls=useCallback(()=>commit(previous=>({...previous,calls:[],oldestCall:null})),[commit]);
  const active=state.key===key&&!state.unavailable;
  return {...state,messages:active?optimistic.messages:[],calls:active?state.calls:[],unavailable:state.key===key&&state.unavailable,
    hasEvictedEarlierCalls:Boolean(state.oldestCall&&state.calls[0]&&(compareConversationTime(state.calls[0].requestedAt,state.oldestCall.at)||state.calls[0].id.localeCompare(state.oldestCall.id))>0),
    newCount:active?state.newCount:0,away,setViewport,loadOlder:()=>load("before"),loadNewer:()=>load("after"),jumpToLatest,
    retryPage:()=>load(retryDirection.current),wake,addCalls,clearCalls,addOptimistic:optimistic.addOptimistic,retry:optimistic.retry,settle};
}
