/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
import { TicketConversation } from "../components/tickets/ticket-conversation";
import type { CallHistoryEntry } from "../domain/tickets/calls";
const id="71000000-0000-4000-8000-000000000001";
const base={id,ticketId:id,callerId:id,calleeId:id,mode:"audio",direction:"client_to_team",state:"ended",requestedAt:"2026-11-03T12:00:00Z",expiresAt:"2026-11-03T12:15:00Z",ringDeadline:null,acceptedAt:null,answeredAt:null,endedAt:"2026-11-03T12:00:40Z",outcome:"missed",reason:"ring_timeout",version:2,connectedSeconds:0,participantSeconds:0,reconciled:false,message:null,caller:{name:"Client Person",avatarUrl:null,role:"Client"},callee:{name:"Team Person",avatarUrl:null,role:"Owner"}} satisfies CallHistoryEntry;
afterEach(cleanup);
it.each([
 ["missed","ring_timeout",null,"Missed"],
 ["declined","callee_declined",null,"Declined"],
 ["expired","participant_ended",null,"Canceled"],
 ["answered","participant_ended","2026-11-03T12:00:10Z","Ended"],
] as const)("shows authoritative %s calls in both conversation views",(outcome,reason,answeredAt,label)=>{
 for(const clientView of [false,true]){
  const view=render(<TicketConversation messages={[]} orderChat clientView={clientView} callHistory={[{...base,outcome,reason,answeredAt}]}/>);
  expect(screen.getByText(`${label} voice call`)).toBeInTheDocument();
  expect(screen.getByText(/Client Person.*Team Person/)).toBeInTheDocument();
  expect(view.container.querySelectorAll('li[data-call-id]')).toHaveLength(1);
  expect(view.container.querySelector('li[data-call-id] time')).toHaveAttribute("datetime",base.requestedAt);
  expect(within(screen.getByRole("region",{name:"Conversation"})).queryByRole("button",{name:"Reply"})).not.toBeInTheDocument();
  view.unmount();
 }
});
