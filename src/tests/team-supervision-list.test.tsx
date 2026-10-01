/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSupervisionActionResult } from "../app/actions/team-supervision";
import * as supervisionActions from "../app/actions/team-supervision";
import {
  activeNavigationRoute,
  navigationForModules,
  titleForPath,
} from "../components/shell/nav-registry";
import { SupervisedConversationsWorkspace } from "../components/team-supervision/supervised-conversations-workspace";
import {
  groupSupervisedConversationsByEmployee,
  type SupervisedConversationPage,
  type SupervisedConversationSummary,
  type SupervisedTranscriptPage,
} from "../domain/team-supervision/projections";

vi.mock("../app/actions/team-supervision", () => ({
  listSupervisedConversationsAction: vi.fn(),
  getSupervisedConversationAction: vi.fn(),
  listSupervisedMessagesBeforeAction: vi.fn(),
  getSupervisedMessageWindowAction: vi.fn(),
  searchSupervisedConversationAction: vi.fn(),
}));

const detailAction = vi.mocked(supervisionActions.getSupervisedConversationAction);
const listAction = vi.mocked(supervisionActions.listSupervisedConversationsAction);

beforeEach(() => vi.clearAllMocks());
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

const person = (profileId: string, displayName: string | null, archived = false) => ({
  profileId,
  displayName,
  avatarUrl: null,
  archived,
});

/** William talks to Licaros and Maria; Licaros also talks to Maria. */
function directory() {
  const william = person("w", "William Jones");
  const licaros = person("l", "Licaros Amil");
  const maria = person("m", "Maria Cruz");
  return [
    conversation(1, { participants: [william, licaros], lastMessageAt: "2026-09-03T00:00:00+00:00" }),
    conversation(2, { participants: [maria, william], lastMessageAt: "2026-09-02T00:00:00+00:00" }),
    conversation(3, { participants: [licaros, maria], lastMessageAt: null }),
  ];
}

function renderWorkspace(rows = directory(), nextCursor: SupervisedConversationPage["nextCursor"] = null) {
  return render(<SupervisedConversationsWorkspace initial={page(rows, nextCursor)} />);
}

const employeeRow = (id: string) => document.querySelector<HTMLButtonElement>(`button[data-employee-id="${id}"]`)!;
const conversationRow = (index: number) =>
  document.querySelector<HTMLButtonElement>(`button[data-conversation-id="${conversation(index).conversationId}"]`)!;
const conversationRows = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button[data-conversation-id]")].map(
    (button) => button.dataset.conversationId,
  );
const workspace = () => document.querySelector<HTMLElement>("[data-view]")!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function transcript(
  row: SupervisedConversationSummary,
  body: string,
): TeamSupervisionActionResult<SupervisedTranscriptPage> {
  return {
    ok: true,
    data: {
      ...row,
      messages: [
        {
          messageId: "22222222-2222-4222-8222-000000000001",
          author: { ...row.participants[0] },
          body,
          messageType: "text",
          createdAt: "2026-09-02T10:00:00+00:00",
          reply: null,
          forwarded: false,
          forwardedFromAuthorName: null,
          deletion: null,
          supervisoryNotice: null,
          reactions: [],
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
  };
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

describe("Employee grouping", () => {
  it("lists each participant once, by name, with their conversations in server order", () => {
    const employees = groupSupervisedConversationsByEmployee(directory());
    expect(employees.map((employee) => employee.participant.displayName)).toEqual([
      "Licaros Amil",
      "Maria Cruz",
      "William Jones",
    ]);
    const william = employees[2]!;
    expect(william.conversations.map(({ partner }) => partner.displayName)).toEqual(["Licaros Amil", "Maria Cruz"]);
    expect(william.partnerCount).toBe(2);
  });

  it("counts distinct people, not rows, and sorts unnamed members last", () => {
    const a = person("a", "Ana");
    const b = person("b", "Ben");
    const unnamed = person("u", null);
    // The database keeps one direct key per pair; a duplicate must still not inflate the count.
    const employees = groupSupervisedConversationsByEmployee([
      conversation(1, { participants: [a, b] }),
      conversation(2, { participants: [b, a] }),
      conversation(3, { participants: [unnamed, a] }),
    ]);
    expect(employees.map((employee) => employee.participant.profileId)).toEqual(["a", "b", "u"]);
    expect(employees[0]!.partnerCount).toBe(2);
    expect(employees[0]!.conversations).toHaveLength(3);
    expect(employees[1]!.partnerCount).toBe(1);
  });
});

describe("All Conversations workspace: employee first", () => {
  it("opens on the first employee's conversations with no transcript and no read", () => {
    renderWorkspace();

    expect(screen.getByRole("list", { name: "Employees" })).toBeInTheDocument();
    expect(employeeRow("l")).toHaveAttribute("aria-current", "true");
    expect(employeeRow("l")).toHaveTextContent("Licaros Amil2 people");
    expect(employeeRow("w")).toHaveTextContent("William Jones2 people");
    expect(screen.getByRole("heading", { name: "Licaros Amil" })).toBeInTheDocument();
    expect(conversationRows()).toEqual([conversation(1).conversationId, conversation(3).conversationId]);
    expect(screen.getByText("Select a conversation to view it")).toBeInTheDocument();
    expect(workspace()).toHaveAttribute("data-view", "employees");
    expect(detailAction).not.toHaveBeenCalled();
  });

  it("shows the other participant, activity and archived state, and no participant state", () => {
    const rows = directory();
    rows[0] = { ...rows[0]!, participants: [rows[0]!.participants[0], person("l", "Licaros Amil", true)] };
    renderWorkspace(rows);
    fireEvent.click(employeeRow("w"));

    const list = screen.getByRole("list", { name: "Conversations with William Jones" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Licaros Amil");
    expect(within(items[0]!).getByText("Archived")).toBeInTheDocument();
    expect(within(items[0]!).getByText(/^Last activity/)).toHaveAttribute("dateTime", rows[0]!.lastMessageAt);
    expect(items[0]).not.toHaveTextContent("William");
    expect(document.body.textContent).not.toMatch(/unread|online|offline|typing|seen|delivered/i);
    expect(screen.queryByRole("button", { name: /send|edit|delete/i })).toBeNull();
  });

  it("filters conversations to the chosen employee without reading anything", () => {
    renderWorkspace();
    fireEvent.click(employeeRow("m"));
    expect(employeeRow("m")).toHaveAttribute("aria-current", "true");
    expect(employeeRow("l")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { name: "Maria Cruz" })).toBeInTheDocument();
    expect(screen.getByText("2 people", { selector: "p" })).toBeInTheDocument();
    expect(conversationRows()).toEqual([conversation(2).conversationId, conversation(3).conversationId]);
    // The employee list stays rendered while another employee is chosen.
    expect(screen.getByRole("list", { name: "Employees" }).children).toHaveLength(3);
    expect(detailAction).not.toHaveBeenCalled();
    expect(listAction).not.toHaveBeenCalled();
  });

  it("rapid employee clicks end on the last one", () => {
    renderWorkspace();
    fireEvent.click(employeeRow("w"));
    fireEvent.click(employeeRow("m"));
    fireEvent.click(employeeRow("l"));
    expect(employeeRow("l")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "Licaros Amil" })).toBeInTheDocument();
    expect(conversationRows()).toEqual([conversation(1).conversationId, conversation(3).conversationId]);
  });

  it("loads only the transcript: both lists stay, the row stays selected, the skeleton has no text", () => {
    const pending = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    detailAction.mockReturnValue(pending.promise);
    renderWorkspace();
    fireEvent.click(conversationRow(1));

    const status = screen.getByRole("status", { name: "Loading conversation" });
    expect(status.textContent).toBe("");
    expect(status.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(document.querySelector("[data-skeleton]")).toBeNull();
    expect(screen.getByRole("list", { name: "Employees" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Conversations with Licaros Amil" })).toBeInTheDocument();
    expect(conversationRow(1)).toHaveAttribute("aria-current", "true");
    // The header is known before the read, and the selected employee reads first.
    expect(document.getElementById("supervised-transcript-heading")?.textContent).toMatch(
      /^Licaros Amil.*William Jones$/,
    );
    expect(workspace()).toHaveAttribute("data-view", "transcript");
  });

  it("switching employee closes the transcript and drops its late response", async () => {
    const pending = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    detailAction.mockReturnValue(pending.promise);
    renderWorkspace();
    fireEvent.click(conversationRow(1));

    fireEvent.click(employeeRow("m"));
    expect(screen.queryByRole("status", { name: "Loading conversation" })).toBeNull();
    expect(screen.getByText("Select a conversation to view it")).toBeInTheDocument();

    await act(async () => pending.resolve(transcript(directory()[0]!, "Licaros secret")));
    expect(screen.queryByText("Licaros secret")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.querySelector("button[data-conversation-id][aria-current]")).toBeNull();
    expect(detailAction).toHaveBeenCalledTimes(1);
  });

  it("keeps the transcript when the same employee is chosen again", async () => {
    detailAction.mockResolvedValue(transcript(directory()[0]!, "Still here"));
    renderWorkspace();
    await act(async () => fireEvent.click(conversationRow(1)));
    fireEvent.click(employeeRow("l"));
    expect(screen.getByText("Still here")).toBeInTheDocument();
    expect(detailAction).toHaveBeenCalledTimes(1);
  });

  it("filters employees by name locally and says when none match", () => {
    renderWorkspace();
    const search = screen.getByRole("searchbox", { name: "Search employees" });
    fireEvent.change(search, { target: { value: "  MAR " } });
    expect(screen.getByRole("list", { name: "Employees" }).children).toHaveLength(1);
    expect(employeeRow("m")).toBeInTheDocument();
    // The chosen employee's conversations stay while the filter hides their row.
    expect(screen.getByRole("heading", { name: "Licaros Amil" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryByRole("list", { name: "Employees" })).toBeNull();
    expect(screen.getByText("No employees match.")).toBeInTheDocument();
    expect(listAction).not.toHaveBeenCalled();
    expect(detailAction).not.toHaveBeenCalled();
  });

  it("drills employees, conversations and transcript with Back at each level", async () => {
    detailAction.mockResolvedValue(transcript(directory()[1]!, "Hi"));
    renderWorkspace();
    expect(workspace()).toHaveAttribute("data-view", "employees");

    fireEvent.click(employeeRow("w"));
    expect(workspace()).toHaveAttribute("data-view", "conversations");

    await act(async () => fireEvent.click(conversationRow(2)));
    expect(workspace()).toHaveAttribute("data-view", "transcript");

    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }));
    expect(workspace()).toHaveAttribute("data-view", "conversations");
    expect(screen.getByRole("heading", { name: "William Jones" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to employees" }));
    expect(workspace()).toHaveAttribute("data-view", "employees");
    expect(employeeRow("w")).toHaveAttribute("aria-current", "true");
    expect(detailAction).toHaveBeenCalledTimes(1);
  });

  it("shows a neutral empty state", () => {
    render(<SupervisedConversationsWorkspace initial={page([])} />);
    expect(screen.getByRole("heading", { name: "No conversations yet" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a safe state for a permission refusal and a generic one otherwise", () => {
    const denied: TeamSupervisionActionResult<SupervisedConversationPage> = {
      ok: false,
      error: { code: "PERMISSION_DENIED", message: "You do not have permission to perform this operation." },
    };
    render(<SupervisedConversationsWorkspace initial={denied} />);
    expect(screen.getByRole("heading", { name: "You don't have access to this view." })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
    cleanup();

    render(
      <SupervisedConversationsWorkspace
        initial={{ ok: false, error: { code: "DATABASE_ERROR", message: "The database operation failed." } }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Conversations could not be loaded.");
    expect(document.body.textContent).not.toMatch(/database/i);
  });

  it("says counts are partial while pages remain, and loads the next page once with the exact cursor", async () => {
    const cursor = {
      beforeLastMessageAt: "2026-09-02T00:00:00+00:00",
      beforeConversationId: conversation(2).conversationId,
    };
    const next = deferred<TeamSupervisionActionResult<SupervisedConversationPage>>();
    listAction.mockReturnValue(next.promise);
    renderWorkspace(directory().slice(0, 2), cursor);
    expect(screen.getByText("Counts include loaded conversations only.")).toBeInTheDocument();
    expect(employeeRow("l")).toHaveTextContent("1 person");

    const button = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(listAction).toHaveBeenCalledTimes(1);
    expect(listAction).toHaveBeenCalledWith(cursor);
    expect(button).toBeDisabled();

    await act(async () => next.resolve(page([directory()[2]!])));
    expect(employeeRow("l")).toHaveTextContent("2 people");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(screen.queryByText("Counts include loaded conversations only.")).toBeNull();
  });

  it("keeps loaded rows and offers another try when a page fails", async () => {
    const cursor = { beforeLastMessageAt: null, beforeConversationId: conversation(1).conversationId };
    listAction.mockResolvedValue({
      ok: false,
      error: { code: "DATABASE_ERROR", message: "The database operation failed." },
    });
    renderWorkspace(directory(), cursor);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more" })));
    expect(screen.getByRole("alert")).toHaveTextContent("More conversations could not be loaded.");
    expect(screen.getByRole("list", { name: "Employees" }).children).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });
});

describe("All Conversations route (source)", () => {
  const route = readFileSync("src/app/(internal)/team/all-conversations/page.tsx", "utf8");
  const styles = readFileSync("src/components/team-supervision/supervised-transcript.module.css", "utf8");

  it("loads every list page up front with the exact cursor, and fails whole on any failed page", () => {
    expect(route).toMatch(/listSupervisedConversationsAction\(\{\s*limit: teamSupervisionListMaxLimit\s*\}\)/);
    expect(route).toMatch(/\.\.\.initial\.data\.nextCursor/);
    expect(route).toMatch(/: next;/);
  });

  it("turns every pane animation off for reduced motion", () => {
    const reduced = styles.slice(styles.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const selector of [".paneBody", ".panel > .scroll", ".skeletonBody", ".conversationPane", ".panel"]) {
      expect(reduced).toContain(selector);
    }
    expect(reduced).toMatch(/animation: none/);
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
    // The rows read nothing at all; the session redirect is left to the action.
    expect(list).not.toMatch(/Action\b|catch|setInterval|setTimeout/);
    expect(route).not.toMatch(/catch/);
  });

  it("reuses no participant Team behaviour", () => {
    const imports = list.match(/^import [\s\S]*?;$/gm)?.join("\n") ?? "";
    expect(imports).toMatch(/team\/team-avatar/);
    expect(imports).not.toMatch(
      /team-messages-drawer|team-conversation-view|team-presence|use-team|team-rich-composer|team-message-actions|team-voice|team-messages"/,
    );
    expect(list).not.toMatch(/markRead|presence=|Typing/);
  });
});
