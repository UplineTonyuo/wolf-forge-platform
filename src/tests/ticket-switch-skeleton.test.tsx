/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { matchActiveTicketDetail } from "../components/team/team-messages-drawer";
import type { TicketDetail } from "../domain/tickets/schema";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) =>
  readFileSync(resolve(root, path), "utf8").replaceAll(String.fromCharCode(13), "");

function detail(id: string, subject: string): TicketDetail {
  return { ticket: { id, subject }, messages: [] } as unknown as TicketDetail;
}

const gmb = detail("ticket-a", "GMB SERVICE");
const platium = detail("ticket-b", "Platium Service");

describe("A Ticket conversation renders only from detail for the selected Ticket", () => {
  it("refuses detail that belongs to a different Ticket", () => {
    // The exact switch that used to flash: Platium is selected while GMB's
    // detail is still the only one in state.
    expect(matchActiveTicketDetail(gmb, "ticket-b")).toBeNull();
    expect(matchActiveTicketDetail(platium, "ticket-a")).toBeNull();
  });

  it("passes through detail whose id is the selected one", () => {
    expect(matchActiveTicketDetail(gmb, "ticket-a")).toBe(gmb);
    expect(matchActiveTicketDetail(platium, "ticket-b")).toBe(platium);
  });

  it("renders nothing while no detail has arrived, or none is selected", () => {
    expect(matchActiveTicketDetail(null, "ticket-a")).toBeNull();
    expect(matchActiveTicketDetail(gmb, null)).toBeNull();
    expect(matchActiveTicketDetail(null, null)).toBeNull();
  });

  it("keeps the previous detail addressable, so returning to a Ticket is instant", () => {
    // Not cleared on switch on purpose: the match, not the state, is what
    // decides whether it may paint.
    expect(matchActiveTicketDetail(gmb, "ticket-a")).toBe(gmb);
  });
});

describe("The drawer wires that rule into every Ticket render site", () => {
  const drawer = read("components/team/team-messages-drawer.tsx");

  it("gates the conversation, the header and the inspector on the matched detail", () => {
    expect(drawer).toContain("const activeTicketDetail = matchActiveTicketDetail(ticketDetail, activeTicketId);");
    expect(drawer).toContain("{activeTicketId && activeTicketDetail ? (");
    expect(drawer).toContain('{pane === "tickets" && activeTicketDetail ? (');
    // No render site may read the raw state again.
    expect(drawer).not.toContain("ticketDetail.ticket.");
  });

  it("shows the skeleton whenever a Ticket is selected without matching detail", () => {
    // The branch that used to be `activeTicketId && ticketDetailLoading`.
    expect(drawer).not.toContain("ticketDetailLoading");
    expect(drawer).toContain(") : activeTicketId ? (");
    expect(drawer).toContain("styles.ticketSkeletonTitle");
    expect(drawer).toContain("styles.ticketSkeletonRef");
  });

  it("holds the ticket pane's shape, not the Select prompt, while the list is on its first load", () => {
    const branch = drawer.slice(drawer.indexOf(") : !ticketInboxList.loaded && ticketInboxList.tickets.length === 0 ? ("));
    expect(branch.length).toBeLessThan(drawer.length);
    expect(branch.indexOf("styles.skeletonList")).toBeLessThan(branch.indexOf("Select a Ticket"));
  });

  it("keeps the stale-response guard", () => {
    expect(drawer).toContain("if (activeTicketIdRef.current !== ticketId) return;");
  });
});

describe("The Ticket page heading is page content, not navigation", () => {
  it("gives the Ticket page header no sticky positioning at any breakpoint", () => {
    const css = read("components/tickets/tickets.module.css");
    const rules = [...css.matchAll(/\.ticketDetailPage[^{]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toContain("position: sticky");
      expect(rule).not.toContain("position: fixed");
      expect(rule).not.toContain("z-index");
    }
  });

  it("still leaves the shell's own mobile command bar sticky", () => {
    const globals = read("app/globals.css");
    expect(globals).toContain(".workspace-command-bar");
    expect(globals).toMatch(/\.workspace-command-bar\s*\{[^}]*position:\s*sticky/);
  });
});
