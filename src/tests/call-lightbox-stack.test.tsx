/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
import { PortalDialog } from "../components/account/ui/portal-dialog";
import { TicketConversation } from "../components/tickets/ticket-conversation";
import type { TicketDetailMessage } from "../domain/tickets/schema";
const id="71000000-0000-4000-8000-000000000001";
const message={id,ticket_id:id,author_profile_id:id,author_name:"Synthetic Person",author_avatar_url:null,author_type:"client",message_kind:"reply",visibility:"client",body:"Picture",created_at:"2026-11-03T12:00:00Z",attachments:[{id,original_name:"evidence.png",mime_type:"image/png",size_bytes:10,created_at:"2026-11-03T12:00:00Z"}]} as TicketDetailMessage;
afterEach(cleanup);
it("keeps the call foreground and releases inert/scroll locks when a covered lightbox unmounts",()=>{
 const decline=vi.fn();
 function Fixture({incoming=false,conversation=true}:{incoming?:boolean;conversation?:boolean}){
  return <>{conversation?<TicketConversation messages={[message]}/>:<p>New route</p>}<PortalDialog open={incoming} onClose={decline} title="Incoming call" layer="call"><button>Answer</button><button>Decline</button></PortalDialog></>;
 }
 document.body.style.overflow="auto";
 const view=render(<Fixture/>);fireEvent.click(screen.getByRole("button",{name:"evidence.png"}));
 expect(screen.getByRole("dialog",{name:"evidence.png"})).toBeInTheDocument();
 view.rerender(<Fixture incoming/>);fireEvent.keyDown(document,{key:"Escape"});
 expect(decline).toHaveBeenCalledOnce();expect(screen.getByRole("dialog",{name:"evidence.png",hidden:true})).toBeInTheDocument();
 view.rerender(<Fixture incoming={false}/>);fireEvent.keyDown(document,{key:"Escape"});
 expect(decline).toHaveBeenCalledOnce();expect(screen.getByRole("dialog",{name:"evidence.png",hidden:true})).toBeInTheDocument();
 view.rerender(<Fixture incoming conversation={false}/>);
 expect(view.container).toHaveAttribute("inert");expect(document.body.style.overflow).toBe("hidden");
 view.unmount();expect(view.container).not.toHaveAttribute("inert");expect(document.body.style.overflow).toBe("auto");
 document.body.style.overflow="";
});
