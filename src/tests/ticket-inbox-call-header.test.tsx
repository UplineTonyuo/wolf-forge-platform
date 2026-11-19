/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
const f=vi.hoisted(()=>({detail:vi.fn(),list:vi.fn()}));
vi.mock("../app/actions/team-messages");
vi.mock("../app/actions/tickets",()=>({getTicketInboxConversationAction:f.detail,listTicketSummariesAction:f.list,listTicketAssigneesAction:vi.fn(async()=>({ok:true,data:[]}))}));
vi.mock("../components/team/use-team-sync-controller",()=>({useTeamSyncController:()=>({refreshNow:vi.fn()})}));
vi.mock("../components/tickets/ticket-admin-conversation",()=>({TicketAdminConversation:()=> <textarea aria-label="Existing draft" defaultValue="Keep this draft"/>}));
vi.mock("../components/tickets/ticket-inspector",()=>({TicketInspector:()=>null}));
import { TeamMessagesDrawer } from "../components/team/team-messages-drawer";
import { CallController } from "../components/calls/call-controller";
import { InboxCallProvider, useInboxCalls } from "../components/calls/call-provider";
const id="71000000-0000-4000-8000-000000000001";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("internal subject-header controls use the existing shared controller without replacing the draft",async()=>{
 f.list.mockResolvedValue({ok:true,data:{tickets:[],total:20}});
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
 fireEvent.click(screen.getByRole("button", {name:"Next page"}));
 expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
 expect(screen.getByRole("button", {name:"Next page"})).toBeDisabled();
 expect(screen.getByRole("textbox",{name:"Existing draft"})).toHaveValue("Keep this draft");
 fireEvent.click(voice);expect(await screen.findByRole("button",{name:"Check microphone"})).toBeInTheDocument();
 expect(prepare).toHaveBeenCalledWith(id);expect(send.mock.calls.some(([url])=>String(url).includes("action=prepare"))).toBe(true);
 expect(shared).not.toBeNull();expect(prepare.mock.contexts).toEqual([shared]);
 expect(screen.getByRole("textbox",{name:"Existing draft",hidden:true})).toHaveValue("Keep this draft");
});

it("closes the selected conversation when a superseded page returns a permission denial", async () => {
  f.list.mockReset().mockResolvedValue({ ok: true, data: { tickets: [], total: 20 } });
  f.detail.mockResolvedValue({ ok: true, data: {
    ticket: { id, subject: "Protected conversation", public_ref: "T-1", status: "open", archived_at: null },
    messages: [], client_name: "Synthetic Client", company_name: null,
  } });
  render(<TeamMessagesDrawer open onClose={() => {}} actorProfileId={id} actorName="Synthetic Owner"
    canManageTasks={false} canUseTeamMessages={false}
    ticketCapabilities={{ view: true, reply: true, create: false, edit: false, assign: false, internalNotes: false, archive: false }}
    initialConversationId={null} initialTicketId={id} onUnreadChange={() => {}} onRequestOpen={() => {}} />);
  await screen.findByText("Protected conversation");
  await screen.findByText("Page 1 of 2");

  let denyPage!: () => void;
  f.list.mockImplementationOnce(() => new Promise(resolve => {
    denyPage = () => resolve({ ok: false, code: "PERMISSION_DENIED", error: "Ticket access revoked" });
  }));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(f.list).toHaveBeenLastCalledWith(2, "");
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(screen.getByText("Protected conversation")).toBeInTheDocument();
  await act(async () => denyPage());
  expect(screen.queryByText("Protected conversation")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Existing draft" })).not.toBeInTheDocument();
  expect(screen.getByText("Tickets are unavailable.")).toBeInTheDocument();
});
