/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as hooks from "../components/tickets/use-ticket-conversation-messages";
import {useOptimisticTicketMessages} from "../components/tickets/use-optimistic-ticket-messages";
import type { TicketDetailMessage } from "../domain/tickets/schema";
import type { OrderPageInfo } from "../domain/orders/conversation-page";
import {retainOrderTimeline} from "../domain/orders/conversation-page";
import type {CallHistoryEntry} from "../domain/tickets/calls";
const mocks=vi.hoisted(()=>({fetch:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("../app/actions/tickets",()=>({sendTicketComposerAction:vi.fn(async()=>({ok:true}))}));
const order="10000000-0000-4000-8000-000000000001";
const message=(n:number)=>({id:`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`,ticket_id:order,body:`Message ${n}`,created_at:`2026-11-10T00:00:00.${String(n).padStart(6,"0")}Z`,attachments:[],visibility:"client",message_kind:"reply",author_type:"client",author_profile_id:"client",author_name:"Client",author_avatar_url:null}) as TicketDetailMessage;
const initial=Array.from({length:10},(_,n)=>message(n+91));
const page:OrderPageInfo={before:"before-91",after:"after-100",hasOlder:true,hasNewer:false,source:`project:${order}`};
function response(messages:TicketDetailMessage[],overrides:Record<string,unknown>={}) {
  return {ok:true,status:200,json:async()=>({ok:true,data:{orderId:order,messages,updates:[],page,fingerprint:Math.random().toString(),changed:true,...overrides}})} as Response;
}
function Harness({id=order,serverMessages=initial}:{id?:string;serverMessages?:TicketDetailMessage[]}) {
  const state=hooks.useOrderConversationMessages({orderId:id,serverMessages,initialPage:page,mode:"client",viewerProfileId:"client"});
  return <div><ul>{state.messages.map(m=><li key={m.id}>{m.body}</li>)}</ul>
    <button onClick={()=>void state.loadOlder()} disabled={state.busy}>Older</button>
    <button onClick={()=>state.setViewport(false,initial[0]!.id)}>Read history</button>
    <button onClick={()=>void state.jumpToLatest()}>Latest</button>
    <button onClick={state.wake}>Poll</button>
    <span>{state.newCount} new</span><span>{state.error}</span><span>{state.unavailable?"Unavailable":"Available"}</span>
  </div>;
}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal("fetch",mocks.fetch);
  Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});
  Object.defineProperty(navigator,"onLine",{configurable:true,value:true});
  mocks.fetch.mockResolvedValue(response(initial));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
describe("Order page state",()=>{
  it("resets the evicted call interval on Jump to latest so intermediate calls can be reloaded",async()=>{
    const calls=Array.from({length:100},(_,i)=>({id:`call-${String(i+1).padStart(3,"0")}`,requestedAt:i<10?"2026-11-10T00:00:00.000000Z":`2026-11-10T00:00:01.${String(i).padStart(6,"0")}Z`})) as CallHistoryEntry[];
    // A reachable older window: 190 mixed entries have evicted newer calls C11..C100.
    const old=retainOrderTimeline(Array.from({length:90},(_,n)=>message(n+1)),calls,"before",message(1).id);
    expect(old.messages.length+old.calls.length).toBe(100);
    expect(old.calls.map(c=>c.id)).toEqual(calls.slice(0,10).map(c=>c.id));
    function CallWindow(){const state=hooks.useOrderConversationMessages({orderId:order,serverMessages:old.messages,initialPage:page,mode:"client",viewerProfileId:"client"});return <><button onClick={()=>state.addCalls(old.calls,true)}>Old interval</button><button onClick={()=>void state.jumpToLatest()}>Reset latest</button><button onClick={()=>state.addCalls(calls.slice(50),false)}>Latest calls</button><button onClick={()=>state.addCalls(calls.slice(0,50),true)}>Earlier call page</button><span data-testid="call-window">{state.calls.map(c=>c.id).join(",")}</span></>}
    render(<CallWindow/>);await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());fireEvent.click(screen.getByText("Old interval"));
    expect(screen.getByTestId("call-window")).toHaveTextContent("call-001");
    fireEvent.click(screen.getByText("Reset latest"));await waitFor(()=>expect(screen.getByTestId("call-window")).toBeEmptyDOMElement());
    fireEvent.click(screen.getByText("Latest calls"));expect(screen.getByTestId("call-window").textContent?.split(",")[0]).toBe("call-051");
    fireEvent.click(screen.getByText("Earlier call page"));for(let n=11;n<=50;n++)expect(screen.getByTestId("call-window")).toHaveTextContent(`call-${String(n).padStart(3,"0")}`);
  });
  it("rejects a delayed latest snapshot superseded by a newer poll and retained-row reaction update",async()=>{
    let finish!:(response:Response)=>void;const frames:Array<{hasNew:boolean;reaction:number}>=[];
    function Race(){const state=hooks.useOrderConversationMessages({orderId:order,serverMessages:initial,initialPage:page,mode:"client",viewerProfileId:"client"});frames.push({hasNew:state.messages.some(m=>m.id===message(101).id),reaction:state.messages.find(m=>m.id===message(100).id)?.reactions?.[0]?.reaction_count??0});return <><button onClick={()=>void state.jumpToLatest()}>Delayed latest</button><button onClick={state.wake}>Newer poll</button>{state.messages.map(m=><p key={m.id}>{m.body}</p>)}</>}
    render(<Race/>);await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());await act(async()=>{});
    mocks.fetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve}));fireEvent.click(screen.getByText("Delayed latest"));
    const updated={...message(100),reactions:[{reaction_code:"like",reaction_count:2,reacted_by_me:true,reactor_names:["Client","Staff"]}]};
    const newer=[...initial.slice(1).map(m=>m.id===updated.id?updated:m),message(101)];
    mocks.fetch.mockResolvedValue(response(newer,{updates:[updated]}));fireEvent.click(screen.getByText("Newer poll"));await screen.findByText("Message 101");
    const afterNew=frames.length;
    await act(async()=>finish(response(initial)));
    expect(frames.slice(afterNew).every(frame=>frame.hasNew&&frame.reaction===2)).toBe(true);
    expect(screen.getByText("Message 101")).toBeInTheDocument();
  });
  it("never paints an accepted optimistic send beside its canonical request identity",async()=>{
    const renders:number[]=[];
    function Optimistic({messages}:{messages:TicketDetailMessage[]}){
      const state=useOptimisticTicketMessages(messages,{mode:"client",confirmation:"request-id"});
      renders.push(state.messages.filter(m=>m.body==="One send").length);
      return <button onClick={()=>{state.addOptimistic({requestId:order,body:"One send",attachment:null,replyTo:null,target:{kind:"order",orderId:order}});state.settle(order,true)}}>Optimistic send</button>;
    }
    const view=render(<Optimistic messages={[]}/>);fireEvent.click(screen.getByText("Optimistic send"));
    view.rerender(<Optimistic messages={[{...message(101),body:"One send",requestId:order}]}/>);
    expect(renders.every(count=>count<=1)).toBe(true);
  });
  it("prepends ten, suppresses duplicate clicks, and preserves loaded history through router refresh",async()=>{
    const view=render(<Harness/>);
    await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());
    mocks.fetch.mockResolvedValue(response(Array.from({length:10},(_,n)=>message(n+81)),{page:{...page,before:"before-81",after:"after-90",hasNewer:true}}));
    fireEvent.click(screen.getByText("Older"));fireEvent.click(screen.getByText("Older"));
    await screen.findByText("Message 81");
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(mocks.fetch.mock.calls.filter(([,o])=>JSON.parse(o.body).page.direction==="before")).toHaveLength(1);
    view.rerender(<Harness serverMessages={[...initial]}/>);
    expect(screen.getByText("Message 81")).toBeInTheDocument();
  });
  it("retains valid history after failure and allows retry",async()=>{
    render(<Harness/>);await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());
    mocks.fetch.mockRejectedValueOnce(new Error("network"));fireEvent.click(screen.getByText("Older"));
    await screen.findByText(/could not be loaded/i);expect(screen.getByText("Message 91")).toBeInTheDocument();
    mocks.fetch.mockResolvedValue(response([message(90)]));fireEvent.click(screen.getByText("Older"));await screen.findByText("Message 90");
  });
  it("keeps arrivals out of the reading window until a bounded jump to latest",async()=>{
    render(<Harness/>);await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Read history"));
    mocks.fetch.mockResolvedValue(response(Array.from({length:10},(_,n)=>message(n+111))));
    fireEvent.click(screen.getByText("Poll"));await screen.findByText("10 new");
    expect(screen.queryByText("Message 120")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Latest"));await screen.findByText("Message 120");
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });
  it("confirms an accepted send outside the newest ten without retaining a duplicate pending bubble",async()=>{
    function Pending(){
      const state=hooks.useOrderConversationMessages({orderId:order,serverMessages:initial,initialPage:page,mode:"client",viewerProfileId:"client"});
      return <><button onClick={()=>{state.addOptimistic({requestId:"20000000-0000-4000-8000-000000000001",body:"Accepted outside window",attachment:null,replyTo:null,target:{kind:"order",orderId:order}});state.settle("20000000-0000-4000-8000-000000000001",true)}}>Send</button><button onClick={state.wake}>Check</button>{state.messages.map(m=><p key={m.id}>{m.body}</p>)}</>;
    }
    render(<Pending/>);await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());
    mocks.fetch.mockResolvedValue(response(Array.from({length:10},(_,n)=>message(n+111)),{confirmedRequestIds:["20000000-0000-4000-8000-000000000001"]}));
    fireEvent.click(screen.getByText("Send"));
    fireEvent.click(screen.getByText("Check"));
    await waitFor(()=>expect(screen.queryByText("Accepted outside window")).not.toBeInTheDocument());
  });
  it("clears protected history and ignores a late history response after identity change",async()=>{
    let finish!:(value:Response)=>void;
    const view=render(<Harness/>);await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());
    mocks.fetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve}));
    fireEvent.click(screen.getByText("Older"));
    mocks.fetch.mockResolvedValue(response([],{orderId:"other",page:{...page,source:"project:other"}}));
    view.rerender(<Harness id="other" serverMessages={[]}/>);
    await act(async()=>finish(response([message(1)])));
    expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Message 91")).not.toBeInTheDocument();
  });
});
