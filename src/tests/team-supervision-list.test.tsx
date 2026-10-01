/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamSupervisionActionResult } from "../app/actions/team-supervision";
import * as supervisionActions from "../app/actions/team-supervision";
import {
  activeNavigationRoute,
  navigationForModules,
  titleForPath,
} from "../components/shell/nav-registry";
import { SupervisedConversationList } from "../components/team-supervision/supervised-conversation-list";
import type {
  SupervisedConversationPage,
  SupervisedConversationSummary,
} from "../domain/team-supervision/projections";

vi.mock("../app/actions/team-supervision", () => ({ listSupervisedConversationsAction: vi.fn() }));

afterEach(cleanup);

function conversation(index: number, overrides: Partial<SupervisedConversationSummary> = {}): SupervisedConversationSummary {
  const id = `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
  return {
    conversationId: id,
    kind: "direct",
    createdAt: "2026-09-01T00:00:00+00:00",
    lastMessageAt: "2026-09-02T00:00:00+00:00",
    participants: [
      { profileId: `a-${index}`, displayName: `Anthony ${index}`, avatarUrl: null, archived: false },
      { profileId: `b-${index}`, displayName: `John ${index}`, avatarUrl: null, archived: false },
    ],
    ...overrides,
  };
}

function page(conversations: SupervisedConversationSummary[], nextCursor: SupervisedConversationPage["nextCursor"] = null) {
  return { ok: true, data: { conversations, nextCursor } } as const;
}

describe("All Conversations navigation (presentation only)", () => {
  const ids = (modules: Record<string, boolean>) =>
    navigationForModules(modules).flatMap((category) => category.items.map((item) => item.id));

  it("shows the entry only when the resolver granted team_supervision", () => {
    expect(ids({ team: true, team_supervision: true })).toEqual(["team", "team_supervision"]);
    expect(ids({ team: true })).toEqual(["team"]);
    expect(ids({ team: true, team_supervision: false })).toEqual(["team"]);
  });

  it("lights only the most specific route", () => {
    expect(activeNavigationRoute("/team/all-conversations")).toBe("/team/all-conversations");
    expect(activeNavigationRoute("/team")).toBe("/team");
    expect(titleForPath("/team/all-conversations")).toBe("All Conversations");
  });
});

describe("All Conversations list", () => {
  it("renders both participants and activity, with no preview or participant state", () => {
    const row = conversation(1, {
      participants: [
        { profileId: "a", displayName: "Anthony Paghubasan", avatarUrl: null, archived: false },
        { profileId: "b", displayName: "John Smith", avatarUrl: null, archived: true },
      ],
    });
    render(<SupervisedConversationList initial={page([row, conversation(2, { lastMessageAt: null })])} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Anthony Paghubasan")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("John Smith")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Archived")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/^Last activity/)).toHaveAttribute("dateTime", row.lastMessageAt);
    expect(within(rows[1]!).getByText("No messages yet")).toBeInTheDocument();

    // Not the participant Team view: nothing to press, type or mark.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.body.textContent).not.toMatch(/unread|online|offline|typing|seen|delivered/i);
  });

  it("keeps the server order", () => {
    const rows = [conversation(3), conversation(1), conversation(2)];
    render(<SupervisedConversationList initial={page(rows)} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent?.match(/Anthony \d/)?.[0])).toEqual([
      "Anthony 3",
      "Anthony 1",
      "Anthony 2",
    ]);
  });

  it("shows a neutral empty state", () => {
    render(<SupervisedConversationList initial={page([])} />);
    expect(screen.getByRole("heading", { name: "No conversations yet" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a safe state for a permission refusal and a generic one otherwise", () => {
    const denied: TeamSupervisionActionResult<SupervisedConversationPage> = {
      ok: false,
      error: { code: "PERMISSION_DENIED", message: "You do not have permission to perform this operation." },
    };
    render(<SupervisedConversationList initial={denied} />);
    expect(screen.getByRole("heading", { name: "You don't have access to this view." })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
    cleanup();

    render(
      <SupervisedConversationList
        initial={{ ok: false, error: { code: "DATABASE_ERROR", message: "The database operation failed." } }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Conversations could not be loaded.");
    expect(document.body.textContent).not.toMatch(/database/i);
  });

  it("loads the next page once with the exact cursor, and hides the button at the end", async () => {
    const cursor = { beforeLastMessageAt: "2026-09-02T00:00:00+00:00", beforeConversationId: conversation(1).conversationId };
    let resolve!: (value: TeamSupervisionActionResult<SupervisedConversationPage>) => void;
    vi.mocked(supervisionActions.listSupervisedConversationsAction).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<SupervisedConversationList initial={page([conversation(1)], cursor)} />);

    const button = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(supervisionActions.listSupervisedConversationsAction).toHaveBeenCalledTimes(1);
    expect(supervisionActions.listSupervisedConversationsAction).toHaveBeenCalledWith(cursor);
    expect(button).toBeDisabled();

    resolve(page([conversation(2)]));
    expect(await screen.findByText("Anthony 2")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("keeps loaded rows and offers another try when a page fails", async () => {
    const cursor = { beforeLastMessageAt: null, beforeConversationId: conversation(1).conversationId };
    vi.mocked(supervisionActions.listSupervisedConversationsAction).mockResolvedValue({
      ok: false,
      error: { code: "DATABASE_ERROR", message: "The database operation failed." },
    });
    render(<SupervisedConversationList initial={page([conversation(1)], cursor)} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("More conversations could not be loaded.");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });
});

describe("All Conversations boundary (source)", () => {
  const list = readFileSync("src/components/team-supervision/supervised-conversation-list.tsx", "utf8");
  const route = readFileSync("src/app/(internal)/team/all-conversations/page.tsx", "utf8");

  it("reaches data only through the list action", () => {
    for (const source of [list, route]) {
      expect(source).not.toMatch(
        /supabase|team-supervision-(repository|service)|next-server|role ===|getSupervisedConversation|searchSupervised|MessagesBefore|MessageWindow/,
      );
    }
    // The session redirect is left to the action; nothing here catches it.
    expect(list).not.toMatch(/catch|setInterval|setTimeout/);
    expect(route).not.toMatch(/catch/);
  });

  it("reuses no participant Team behaviour", () => {
    const imports = list.match(/^import .*$/gm)?.join("\n") ?? "";
    expect(imports).toMatch(/team\/team-avatar/);
    expect(imports).not.toMatch(
      /team-messages-drawer|team-conversation-view|team-presence|use-team|team-rich-composer|team-message-actions|team-voice|team-messages"/,
    );
    expect(list).not.toMatch(/markRead|presence=|Typing/);
  });
});
