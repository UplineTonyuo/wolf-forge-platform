/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {createRef} from "react";
import {TicketConversation} from "../components/tickets/ticket-conversation";
import type {TicketDetailMessage} from "../domain/tickets/schema";
vi.mock("../app/actions/tickets",()=>({toggleTicketMessageReactionAction:vi.fn(),forwardTicketMessageToTeamAction:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
afterEach(cleanup);
it("exposes a labelled keyboard-scrollable Order transcript independently of its header/history actions",()=>{
  const ref=createRef<HTMLDivElement>();
  const message={id:"m",ticket_id:"t",author_profile_id:null,author_name:null,author_avatar_url:null,author_type:"client",message_kind:"reply",visibility:"client",body:"Long message",created_at:"2026-11-10T00:00:00Z",attachments:[]} as TicketDetailMessage;
  render(<TicketConversation orderChat messages={[message]} heading="Project" transcript={{ref,onScroll:()=>{},controls:<button>Load 10 older messages</button>,jump:null}}/>);
  const region=screen.getByRole("region",{name:"Message history"});
  expect(region).toHaveAttribute("tabindex","0");
  expect(region).toContainElement(screen.getByText("Long message"));
  expect(region).not.toContainElement(screen.getByText("Load 10 older messages"));
  expect(ref.current).toBe(region);
  fireEvent.click(screen.getByRole("button",{name:"Message actions"}));
  expect(region).not.toContainElement(screen.getByRole("menu",{name:"Message actions"}));
});
it("leaves standalone Ticket rendering without an Order transcript viewport",()=>{
  render(<TicketConversation messages={[]}/>);
  expect(screen.queryByRole("region",{name:"Message history"})).not.toBeInTheDocument();
});

it("places order actions in the dialog header without rendering a second title", () => {
  const slot = document.createElement("div");
  render(<TicketConversation messages={[]} heading="Project #13" headerSlot={slot}
    callControls={<button>Voice call</button>} headerActions={<button>Internal notes</button>} />);
  expect(slot).toHaveTextContent("Voice call");
  expect(slot).toHaveTextContent("Internal notes");
  expect(screen.queryByRole("heading", { name: "Project #13" })).toBeNull();
});
