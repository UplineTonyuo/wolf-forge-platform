/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TeamTicketsPane } from "../components/team/team-tickets-pane";
import type { TicketSummary } from "../domain/tickets/schema";
const controls = { page: 1, pages: 1, query: "", onPageChange: vi.fn(), onQueryChange: vi.fn() };
afterEach(cleanup);
it("keeps Unanswered separate from selection/unread and only renders true server flags",()=>{
 const base={public_ref:"T-1",subject:"Client question",company_name:null,client_name:"Client",status:"open",last_message_at:null,updated_at:"2026-11-03T12:00:00Z"};
 const rows=[{...base,ticket_id:"one",unanswered:true},{...base,ticket_id:"two",subject:"Answered",unanswered:false},{...base,ticket_id:"three",subject:"Unknown",unanswered:null}] as TicketSummary[];
 const onSelect=vi.fn();const view=render(<TeamTicketsPane {...controls} tickets={rows} loading={false} error={null} activeTicketId={null} onSelect={onSelect} onRetry={()=>{}}/>);
 expect(screen.getAllByText("Unanswered")).toHaveLength(1);fireEvent.click(screen.getByText("Client question").closest("button")!);expect(onSelect).toHaveBeenCalledWith("one");
 view.rerender(<TeamTicketsPane {...controls} tickets={rows} loading={false} error={null} activeTicketId="one" onSelect={onSelect} onRetry={()=>{}}/>);
 expect(screen.getByText("Unanswered")).toBeInTheDocument();
});
