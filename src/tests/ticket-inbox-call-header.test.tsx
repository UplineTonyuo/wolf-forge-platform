/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
const f=vi.hoisted(()=>({detail:vi.fn()}));
vi.mock("../app/actions/team-messages");
vi.mock("../app/actions/tickets",()=>({getTicketInboxConversationAction:f.detail,listTicketAssigneesAction:vi.fn(async()=>({ok:true,data:[]}))}));
vi.mock("../components/team/use-team-sync-controller",()=>({useTeamSyncController:()=>({refreshNow:vi.fn()})}));
vi.mock("../components/team/use-ticket-inbox-list",()=>({useTicketInboxList:()=>({tickets:[],loaded:true,error:null,refreshNow:vi.fn()})}));
vi.mock("../components/tickets/ticket-admin-conversation",()=>({TicketAdminConversation:()=> <textarea aria-label="Existing draft" defaultValue="Keep this draft"/>}));
vi.mock("../components/tickets/ticket-inspector",()=>({TicketInspector:()=>null}));
import { TeamMessagesDrawer } from "../components/team/team-messages-drawer";
import { CallController } from "../components/calls/call-controller";
import { InboxCallProvider, useInboxCalls } from "../components/calls/call-provider";
const id="71000000-0000-4000-8000-000000000001";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("internal subject-header controls use the existing shared controller without replacing the draft",async()=>{
 const send=vi.fn<typeof fetch>(async()=>Response.json({ok:true,data:{enabled:true,profileId:id,accountClass:"internal",call:null,ticketId:id,peer:{name:"Synthetic Client",role:"Client",avatarUrl:null}}}));
 vi.stubGlobal("fetch",send);
 let shared:CallController|null=null;
 function Capture(){const controller=useInboxCalls();useEffect(()=>{shared=controller;},[controller]);return null;}
 const prepare=vi.spyOn(CallController.prototype,"prepare");
 f.detail.mockResolvedValue({ok:true,data:{ticket:{id,subject:"Synthetic Ticket",public_ref:"T-1",status:"open",archived_at:null},messages:[],client_name:"Synthetic Client",company_name:null}});
 render(<InboxCallProvider profileId={id} notificationSoundEnabled={false}><Capture/><TeamMessagesDrawer open onClose={()=>{}} actorProfileId={id} actorName="Synthetic Owner" canManageTasks={false} canUseTeamMessages={false}
  ticketCapabilities={{view:true,reply:true,create:false,edit:false,assign:false,internalNotes:false,archive:false}}
  initialConversationId={null} initialTicketId={id} onUnreadChange={()=>{}} onRequestOpen={()=>{}}/></InboxCallProvider>);
 const voice=await screen.findByRole("button",{name:"Voice call"});
 expect(voice.parentElement?.parentElement).toHaveTextContent("Synthetic Ticket");
 expect(screen.getAllByRole("button",{name:"Video call"})).toHaveLength(1);
 fireEvent.click(voice);expect(await screen.findByRole("button",{name:"Check microphone"})).toBeInTheDocument();
 expect(prepare).toHaveBeenCalledWith(id);expect(send.mock.calls.some(([url])=>String(url).includes("action=prepare"))).toBe(true);
 expect(shared).not.toBeNull();expect(prepare.mock.contexts).toEqual([shared]);
 expect(screen.getByRole("textbox",{name:"Existing draft",hidden:true})).toHaveValue("Keep this draft");
});
