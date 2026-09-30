/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSupervisionActionResult } from "../app/actions/team-supervision";
import * as supervisionActions from "../app/actions/team-supervision";
import { SupervisedConversationsWorkspace } from "../components/team-supervision/supervised-conversations-workspace";
import { reconcileLatest } from "../components/team-supervision/supervised-transcript";
import type {
  SupervisedConversationSummary,
  SupervisedMessage,
  SupervisedMessageSearchPage,
  SupervisedMessageSearchResult,
  SupervisedMessageWindow,
  SupervisedTranscriptPage,
} from "../domain/team-supervision/projections";

vi.mock("../app/actions/team-supervision", () => ({
  listSupervisedConversationsAction: vi.fn(),
  getSupervisedConversationAction: vi.fn(),
  listSupervisedMessagesBeforeAction: vi.fn(),
  getSupervisedMessageWindowAction: vi.fn(),
  searchSupervisedConversationAction: vi.fn(),
}));

const detailAction = vi.mocked(supervisionActions.getSupervisedConversationAction);
const historyAction = vi.mocked(supervisionActions.listSupervisedMessagesBeforeAction);
const searchAction = vi.mocked(supervisionActions.searchSupervisedConversationAction);
const windowAction = vi.mocked(supervisionActions.getSupervisedMessageWindowAction);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const msgId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

function conversation(n: number, overrides: Partial<SupervisedConversationSummary> = {}): SupervisedConversationSummary {
  return {
    conversationId: id(n),
    kind: "direct",
    createdAt: "2026-09-01T00:00:00+00:00",
    lastMessageAt: "2026-09-02T00:00:00+00:00",
    participants: [
      { profileId: `a-${n}`, displayName: `Anthony ${n}`, avatarUrl: null, archived: false },
      { profileId: `b-${n}`, displayName: `John ${n}`, avatarUrl: null, archived: false },
    ],
    ...overrides,
  };
}

function message(n: number, overrides: Partial<SupervisedMessage> = {}): SupervisedMessage {
  return {
    messageId: msgId(n),
    author: { profileId: "a-1", displayName: "Anthony 1", avatarUrl: null, archived: false },
    body: `Message ${n}`,
    messageType: "text",
    createdAt: `2026-09-02T10:${String(n).padStart(2, "0")}:00+00:00`,
    reply: null,
    forwarded: false,
    forwardedFromAuthorName: null,
    deletion: null,
    supervisoryNotice: null,
    reactions: [],
    ...overrides,
  };
}

function transcript(n: number, messages: SupervisedMessage[], more = false): TeamSupervisionActionResult<SupervisedTranscriptPage> {
  const summary = conversation(n);
  return {
    ok: true,
    data: {
      conversationId: summary.conversationId,
      kind: "direct",
      createdAt: summary.createdAt,
      lastMessageAt: summary.lastMessageAt,
      participants: summary.participants,
      messages,
      hasMore: more,
      nextCursor: more ? { beforeCreatedAt: messages[0]!.createdAt, beforeMessageId: messages[0]!.messageId } : null,
    },
  };
}

function renderWorkspace(rows = [conversation(1), conversation(2)]) {
  return render(
    <SupervisedConversationsWorkspace initial={{ ok: true, data: { conversations: rows, nextCursor: null } }} />,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// jsdom's name computation drops the whitespace around the hidden "and", so rows are found by id.
const row = (n: number) =>
  document.querySelector<HTMLButtonElement>(`button[data-conversation-id="${id(n)}"]`)!;

describe("Supervised transcript: explicit open only", () => {
  it("reads nothing on render, hover or focus", () => {
    renderWorkspace();
    fireEvent.mouseEnter(row(1));
    fireEvent.mouseOver(row(1));
    fireEvent.focus(row(1));
    // A press that never completes (touch cancelled, pointer dragged away) is not a click.
    fireEvent.pointerDown(row(1));
    fireEvent.mouseDown(row(1));
    fireEvent.touchStart(row(1));
    fireEvent.touchCancel(row(1));
    fireEvent.keyDown(row(1), { key: "Tab" });
    expect(detailAction).not.toHaveBeenCalled();
    expect(historyAction).not.toHaveBeenCalled();
    expect(screen.getByText("Select a conversation to view it")).toBeInTheDocument();
  });

  it("opens once per activation and ignores a second activation while pending", async () => {
    const pending = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    detailAction.mockReturnValue(pending.promise);
    renderWorkspace();

    fireEvent.click(row(1));
    fireEvent.click(row(1));
    expect(detailAction).toHaveBeenCalledTimes(1);
    expect(detailAction).toHaveBeenCalledWith({ conversationId: id(1) });
    expect(screen.getByRole("status", { name: "Loading conversation" })).toBeInTheDocument();
    expect(row(1)).toHaveAttribute("aria-current", "true");

    await act(async () => pending.resolve(transcript(1, [message(1)])));
    expect(screen.getByText("Message 1")).toBeInTheDocument();

    // Already open: re-activating does not read again.
    fireEvent.click(row(1));
    expect(detailAction).toHaveBeenCalledTimes(1);
    expect(historyAction).not.toHaveBeenCalled();
  });

  it("drops a late response for a conversation that is no longer selected", async () => {
    const first = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    const second = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    detailAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderWorkspace();

    fireEvent.click(row(1));
    fireEvent.click(row(2));
    expect(detailAction).toHaveBeenCalledTimes(2);
    expect(detailAction).toHaveBeenLastCalledWith({ conversationId: id(2) });

    await act(async () => second.resolve(transcript(2, [message(2, { body: "From B" })])));
    await act(async () => first.resolve(transcript(1, [message(1, { body: "From A" })])));

    expect(screen.getByText("From B")).toBeInTheDocument();
    expect(screen.queryByText("From A")).toBeNull();
    expect(row(2)).toHaveAttribute("aria-current", "true");
    expect(row(1)).not.toHaveAttribute("aria-current");
  });

  it("never shows a stale result or stale error while the newer open is pending", async () => {
    const first = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    const second = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    const third = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    detailAction
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    renderWorkspace();

    // A -> B -> A: three deliberate opens, three calls, only the last may render.
    fireEvent.click(row(1));
    fireEvent.click(row(2));
    fireEvent.click(row(1));
    expect(detailAction).toHaveBeenCalledTimes(3);

    // The older A and B settle first — a success and a failure — while the newest A is pending.
    await act(async () => first.resolve(transcript(1, [message(1, { body: "Stale A" })])));
    await act(async () =>
      second.resolve({ ok: false, error: { code: "NOT_FOUND", message: "The requested resource was not found." } }),
    );
    expect(screen.queryByText("Stale A")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading conversation" })).toBeInTheDocument();
    expect(row(1)).toHaveAttribute("aria-current", "true");
    expect(row(2)).not.toHaveAttribute("aria-current");

    await act(async () => third.resolve(transcript(1, [message(3, { body: "Fresh A" })])));
    expect(screen.getByText("Fresh A")).toBeInTheDocument();
    expect(detailAction).toHaveBeenCalledTimes(3);
  });

  it("ignores the tail of a double tap, but opens on keyboard activation", async () => {
    detailAction.mockResolvedValue(transcript(1, [message(1)]));
    renderWorkspace();
    // e.g. a double tap on mobile Back whose second tap lands on the revealed row
    fireEvent.click(row(1), { detail: 2 });
    expect(detailAction).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(row(1), { detail: 0 }));
    expect(detailAction).toHaveBeenCalledTimes(1);
  });

  it("switching shows the new conversation loading, never the previous transcript", async () => {
    detailAction.mockResolvedValueOnce(transcript(1, [message(1, { body: "From A" })]));
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    expect(screen.getByText("From A")).toBeInTheDocument();

    const pending = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    detailAction.mockReturnValueOnce(pending.promise);
    fireEvent.click(row(2));
    expect(screen.queryByText("From A")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading conversation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Anthony 2");
    await act(async () => pending.resolve(transcript(2, [message(2, { body: "From B" })])));
    expect(screen.getByText("From B")).toBeInTheDocument();
  });

  it("a double tap on Back closes without opening the row revealed under it", async () => {
    detailAction.mockResolvedValue(transcript(1, [message(1)]));
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    expect(detailAction).toHaveBeenCalledTimes(1);

    // Same finger position: first tap hits Back, the second lands on the revealed row.
    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }), { detail: 1 });
    fireEvent.click(row(1), { detail: 2 });
    expect(detailAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region")).toBeNull();

    // A later ordinary tap is a deliberate open again.
    await act(async () => fireEvent.click(row(1), { detail: 1 }));
    expect(detailAction).toHaveBeenCalledTimes(2);
  });

  it("Back forgets the transcript without reading; reopening is a new open", async () => {
    detailAction.mockResolvedValue(transcript(1, [message(1)]));
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    expect(screen.getByText("Message 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }));
    expect(screen.queryByText("Message 1")).toBeNull();
    expect(detailAction).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.click(row(1)));
    expect(detailAction).toHaveBeenCalledTimes(2);
  });
});

describe("Supervised transcript: rendering", () => {
  async function openWith(messages: SupervisedMessage[], rows?: SupervisedConversationSummary[]) {
    detailAction.mockResolvedValue(transcript(1, messages));
    renderWorkspace(rows);
    await act(async () => fireEvent.click(row(1)));
    return screen.getByRole("region", { name: /Anthony 1/ });
  }

  it("names both participants, marks archived and read-only, and shows no participant state", async () => {
    const panel = await openWith(
      [message(1)],
      [
        conversation(1, {
          participants: [
            { profileId: "a-1", displayName: "Anthony 1", avatarUrl: null, archived: false },
            { profileId: "b-1", displayName: "John 1", avatarUrl: null, archived: true },
          ],
        }),
      ],
    );
    const heading = within(panel).getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Anthony 1");
    expect(heading).toHaveTextContent("John 1");
    expect(within(heading).getByText("Archived")).toBeInTheDocument();
    expect(within(panel).getByText("Read-only")).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/unread|online|offline|last seen|typing|delivered|seen by/i);
  });

  it("renders authors, times, reply, forward, reaction counts, tombstone, voice and activity", async () => {
    const panel = await openWith([
      message(1, {
        body: "Hello **there**",
        reactions: [
          { reactionCode: "like", count: 3 },
          { reactionCode: "heart", count: 1 },
        ],
      }),
      message(2, {
        author: { profileId: "b-1", displayName: "John 1", avatarUrl: null, archived: true },
        body: "Replying now",
        reply: {
          messageId: msgId(1),
          authorProfileId: "a-1",
          authorName: "Anthony 1",
          authorAvatarUrl: null,
          body: "Hello there",
          messageType: "text",
          deletedForEveryone: false,
        },
      }),
      message(3, { body: "Passed along", forwarded: true, forwardedFromAuthorName: "Mary" }),
      message(4, {
        body: "Message deleted",
        deletion: { deletedAt: "2026-09-02T11:00:00+00:00", deletedByProfileId: "a-1", deletedByName: "Anthony 1" },
      }),
      message(5, { body: "Voice message", messageType: "voice", supervisoryNotice: "Unavailable in supervisory view" }),
      message(6, { body: "Ship the report", messageType: "task_activity" }),
    ]);

    // Author identity at each group boundary; nobody is drawn as "me".
    expect(within(panel).getAllByText("Anthony 1").length).toBeGreaterThan(1);
    expect(within(panel).getAllByText("John 1").length).toBeGreaterThan(1);
    expect(within(panel).getAllByText("Archived").length).toBeGreaterThan(0);
    const times = panel.querySelectorAll("ol time");
    expect(times.length).toBeGreaterThan(0);
    expect(times[0]).toHaveAttribute("dateTime", message(1).createdAt);

    expect(within(panel).getByText("there").tagName).toBe("STRONG");
    const reply = panel.querySelector("blockquote")!;
    expect(reply).toHaveTextContent("Replying to Anthony 1");
    expect(reply).toHaveTextContent("Hello there");
    expect(reply.closest("button, a")).toBeNull();
    expect(within(panel).getByText("Forwarded from Mary")).toBeInTheDocument();

    const reactions = within(panel).getByRole("list", { name: "Reactions" });
    expect(within(reactions).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "👍 like: 3",
      "❤️ heart: 1",
    ]);

    expect(within(panel).getByText("Message deleted")).toBeInTheDocument();
    expect(within(panel).getByText("Voice message")).toBeInTheDocument();
    expect(within(panel).getByText("Unavailable in supervisory view")).toBeInTheDocument();
    expect(within(panel).getByText(/Task update: Ship the report/)).toBeInTheDocument();

    // No playback, no media, no path.
    expect(panel.querySelector("audio, video, source, a[download]")).toBeNull();
    expect(panel.innerHTML).not.toMatch(/storage|signed|\.webm|\.ogg|\.mp3/i);
  });

  it("has no composer and no message controls", async () => {
    const panel = await openWith([message(1, { reactions: [{ reactionCode: "like", count: 2 }] })]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("textarea, input, [contenteditable]")).toBeNull();
    const controls = within(panel)
      .queryAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(controls).toEqual(["Back to conversations", "Search this conversation", "Refresh latest"]);
    expect(panel.textContent).not.toMatch(/\b(send|reply|forward|react|delete|hide|pin|task|mute|mark)\b/i);
  });
});

describe("Supervised transcript: history", () => {
  it("loads older messages once per click with the exact cursor and prepends them", async () => {
    const opened = transcript(1, [message(10), message(11)], true);
    detailAction.mockResolvedValue(opened);
    const pending = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    historyAction.mockReturnValue(pending.promise);
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    expect(historyAction).not.toHaveBeenCalled();

    const button = screen.getByRole("button", { name: "Load older messages" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(historyAction).toHaveBeenCalledTimes(1);
    expect(historyAction).toHaveBeenCalledWith({
      conversationId: id(1),
      beforeCreatedAt: message(10).createdAt,
      beforeMessageId: msgId(10),
    });
    expect(button).toBeDisabled();

    await act(async () => pending.resolve(transcript(1, [message(8), message(9)], true)));
    const bodies = [...document.querySelectorAll("[data-message-id]")].map((node) => node.textContent);
    expect(bodies).toEqual(["Message 8", "Message 9", "Message 10", "Message 11"]);

    historyAction.mockResolvedValue(transcript(1, [message(7)], false));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load older messages" })));
    expect(historyAction).toHaveBeenLastCalledWith({
      conversationId: id(1),
      beforeCreatedAt: message(8).createdAt,
      beforeMessageId: msgId(8),
    });
    expect(screen.queryByRole("button", { name: "Load older messages" })).toBeNull();
    expect(detailAction).toHaveBeenCalledTimes(1);
  });

  it("drops a history response that arrives after the conversation changed", async () => {
    detailAction
      .mockResolvedValueOnce(transcript(1, [message(10, { body: "A newest" })], true))
      .mockResolvedValueOnce(transcript(2, [message(20, { body: "B newest" })], false));
    const pending = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    historyAction.mockReturnValue(pending.promise);
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(historyAction).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.click(row(2)));
    await act(async () => pending.resolve(transcript(1, [message(9, { body: "A older" })], false)));

    const bodies = [...document.querySelectorAll("[data-message-id]")].map((node) => node.textContent);
    expect(bodies).toEqual(["B newest"]);
    expect(historyAction).toHaveBeenCalledTimes(1);
    expect(detailAction).toHaveBeenCalledTimes(2);
  });

  it("Back while history is pending makes no further call and leaves nothing behind", async () => {
    detailAction.mockResolvedValue(transcript(1, [message(10)], true));
    const pending = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    historyAction.mockReturnValue(pending.promise);
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }));
    await act(async () => pending.resolve(transcript(1, [message(9)], false)));

    expect(document.querySelector("[data-message-id]")).toBeNull();
    expect(historyAction).toHaveBeenCalledTimes(1);
    expect(detailAction).toHaveBeenCalledTimes(1);
  });

  it("offers no Load older when the first page is the whole history", async () => {
    detailAction.mockResolvedValue(transcript(1, [message(1)], false));
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    expect(screen.queryByRole("button", { name: "Load older messages" })).toBeNull();
  });

  it("keeps messages and allows another click when history fails", async () => {
    detailAction.mockResolvedValue(transcript(1, [message(10)], true));
    historyAction.mockResolvedValue({ ok: false, error: { code: "DATABASE_ERROR", message: "The database operation failed." } });
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load older messages" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Older messages could not be loaded.");
    expect(screen.getByText("Message 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load older messages" })).toBeEnabled();
  });
});

describe("Supervised transcript: safe errors", () => {
  async function openFailing(code: "NOT_FOUND" | "PERMISSION_DENIED" | "DATABASE_ERROR") {
    detailAction.mockResolvedValue({ ok: false, error: { code, message: "The database operation failed on row 42." } });
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    return screen.getByRole("alert");
  }

  it("shows one generic unavailable state", async () => {
    const alert = await openFailing("NOT_FOUND");
    expect(alert).toHaveTextContent("This conversation is unavailable.");
    expect(document.body.textContent).not.toMatch(/group|client|malformed|database|row 42/i);
  });

  it("shows the safe access state", async () => {
    expect(await openFailing("PERMISSION_DENIED")).toHaveTextContent("You don't have access to this view.");
  });

  it("shows a generic failure with an explicit retry", async () => {
    const alert = await openFailing("DATABASE_ERROR");
    expect(alert).toHaveTextContent("This conversation could not be loaded.");
    expect(document.body.textContent).not.toMatch(/database|row 42/i);
    const retry = deferred<TeamSupervisionActionResult<SupervisedTranscriptPage>>();
    detailAction.mockReturnValue(retry.promise);
    const tryAgain = within(alert).getByRole("button", { name: "Try again" });
    fireEvent.click(tryAgain);
    fireEvent.click(tryAgain);
    expect(detailAction).toHaveBeenCalledTimes(2);
    await act(async () => retry.resolve(transcript(1, [message(1)])));
    expect(detailAction).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Message 1")).toBeInTheDocument();
  });

  it("lets a session redirect escape instead of rendering it", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    detailAction.mockRejectedValue(redirect);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).toHaveBeenCalledWith(redirect, expect.anything());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Supervised transcript boundary (source)", () => {
  const files = [
    "src/components/team-supervision/supervised-conversations-workspace.tsx",
    "src/components/team-supervision/supervised-transcript.tsx",
  ].map((path) => readFileSync(path, "utf8"));
  const source = files.join("\n");

  it("reads only through the detail and history actions, never automatically", () => {
    expect(source).not.toMatch(
      /supabase|team-supervision-(repository|service)|next-server|server-only|searchSupervised|team-live|setInterval|setTimeout|visibilitychange|addEventListener\(["']focus|useEffect|IntersectionObserver|onScroll|next\/link|router\.prefetch/,
    );
    expect(source).not.toMatch(/catch/);
    // The window action is imported once and called once, from the result handler.
    expect(source.match(/getSupervisedMessageWindowAction/g)).toHaveLength(2);
  });

  it("reuses only pure Team visuals", () => {
    const imports = source.match(/^import [\s\S]*?;$/gm)?.join("\n") ?? "";
    expect(imports).not.toMatch(
      /team-messages-drawer|team-conversation-view|team-presence|use-team|team-rich-composer|team-message-actions|team-message-reactions|team-voice|team-task|team-pins|team-http-client/,
    );
    expect(source).not.toMatch(/markRead|presence=|reactedByMe|storagePath|signedUrl/);
  });
});

describe("Supervised search", () => {
  type SearchResult = TeamSupervisionActionResult<SupervisedMessageSearchPage>;

  function hit(n: number, overrides: Partial<SupervisedMessageSearchResult> = {}): SupervisedMessageSearchResult {
    return {
      messageId: msgId(100 + n),
      author: { profileId: "b-1", displayName: "John 1", avatarUrl: null },
      createdAt: `2026-09-0${n}T09:15:00+00:00`,
      snippet: `about the invoice number ${n}`,
      ...overrides,
    };
  }

  function page(results: SupervisedMessageSearchResult[], more = false): SearchResult {
    const last = results[results.length - 1];
    return {
      ok: true,
      data: {
        results,
        hasMore: more,
        nextCursor: more && last ? { beforeCreatedAt: last.createdAt, beforeMessageId: last.messageId } : null,
      },
    };
  }

  const failure = (code: "RATE_LIMITED" | "DATABASE_ERROR"): SearchResult => ({
    ok: false,
    error: { code, message: "Something went wrong." },
  });

  const toggle = () => screen.getByRole("button", { name: "Search this conversation" });
  const input = () => screen.getByRole("searchbox", { name: "Search this conversation" });
  const type = (value: string) => fireEvent.change(input(), { target: { value } });
  const submit = () => fireEvent.submit(screen.getByRole("search"));
  const searchStatus = () => document.querySelector("form[role=search] ~ [role=status]")!;
  const resultItems = () =>
    within(screen.getByRole("list", { name: "Search results" })).getAllByRole("listitem");
  const resultTimes = () => resultItems().map((item) => item.querySelector("time")?.getAttribute("datetime"));

  async function openConversation(n = 1) {
    detailAction.mockResolvedValue(transcript(n, [message(1, { body: "Transcript stays" })]));
    await act(async () => fireEvent.click(row(n)));
  }

  async function openSearch() {
    renderWorkspace();
    await openConversation();
    fireEvent.click(toggle());
  }

  it("reads nothing until a deliberate, non-empty submit", async () => {
    await openSearch();
    fireEvent.focus(input());
    type("inv");
    type("invoice");
    fireEvent.keyDown(input(), { key: "a" });
    type("");
    submit();
    type("   ");
    submit();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(searchAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();

    searchAction.mockResolvedValue(page([hit(1)]));
    type("invoice");
    await act(async () => submit());
    expect(searchAction).toHaveBeenCalledTimes(1);
    expect(searchAction).toHaveBeenCalledWith({ conversationId: id(1), query: "invoice" });

    // The same query again is a new deliberate search.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Search" })));
    expect(searchAction).toHaveBeenCalledTimes(2);
    expect(windowAction).not.toHaveBeenCalled();
    expect(historyAction).not.toHaveBeenCalled();
    expect(detailAction).toHaveBeenCalledTimes(1);
  });

  it("searches once while a submit is pending and keeps the transcript visible", async () => {
    const pending = deferred<SearchResult>();
    searchAction.mockReturnValue(pending.promise);
    await openSearch();
    type("invoice");
    submit();
    submit();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(searchAction).toHaveBeenCalledTimes(1);
    expect(searchStatus()).toHaveTextContent("Searching…");
    expect(screen.getByText("Transcript stays")).toBeInTheDocument();
    await act(async () => pending.resolve(page([hit(1)])));
    expect(searchStatus()).toHaveTextContent("1 matching message");
  });

  it("caps the query at the shared 200-character limit without rewriting it", async () => {
    searchAction.mockResolvedValue(page([]));
    await openSearch();
    expect(input()).toHaveAttribute("maxLength", "200");
    const long = "a".repeat(200);
    type(long);
    await act(async () => submit());
    expect(searchAction).toHaveBeenCalledWith({ conversationId: id(1), query: long });
  });

  it("renders author, date and time, and a plain-text snippet in server order", async () => {
    searchAction.mockResolvedValue(
      page([
        hit(3),
        hit(2, {
          author: { profileId: "a-1", displayName: null, avatarUrl: null },
          snippet: '<img src=x onerror="alert(1)"> invoice',
        }),
      ]),
    );
    await openSearch();
    type("invoice");
    await act(async () => submit());

    const items = resultItems();
    expect(resultTimes()).toEqual([hit(3).createdAt, hit(2).createdAt]);
    expect(items[0]).toHaveTextContent("John 1");
    expect(items[0]).toHaveTextContent(/Sep \d+, 2026 · \d+:\d\d/);
    expect(items[0]!.querySelector("mark")).toHaveTextContent("invoice");
    expect(items[0]).toHaveTextContent("about the invoice number 3");
    expect(items[1]).toHaveTextContent("Unnamed member");
    // Markup in a snippet is text, never HTML.
    expect(items[1]!.querySelector("img")).toBeNull();
    expect(items[1]).toHaveTextContent('<img src=x onerror="alert(1)"> invoice');
    // One plain button per result; no id in visible text, no participant or policy state.
    const region = screen.getByRole("list", { name: "Search results" });
    expect(within(region).getAllByRole("button")).toHaveLength(2);
    expect(region.textContent).not.toContain(msgId(103));
    expect(region.innerHTML).not.toMatch(/\b(hidden|deleted|voice|storage|unread|seen|online)\b|\.webm/i);
    expect(document.body.innerHTML).not.toMatch(/[]/);
  });

  it("shows a neutral zero-result state without echoing the query", async () => {
    searchAction.mockResolvedValue(page([]));
    await openSearch();
    type("nothing-matches-this");
    await act(async () => submit());
    expect(searchStatus()).toHaveTextContent("No matching messages");
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
    expect(document.body.textContent).not.toContain("nothing-matches-this");
    expect(screen.getByText("Transcript stays")).toBeInTheDocument();
  });

  it("shows a safe rate-limit message and does not retry", async () => {
    searchAction.mockResolvedValue(failure("RATE_LIMITED"));
    await openSearch();
    type("invoice");
    await act(async () => submit());
    expect(screen.getByRole("alert")).toHaveTextContent("Too many searches. Try again shortly.");
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(searchAction).toHaveBeenCalledTimes(1);
  });

  it("shows one generic failure for any other error", async () => {
    searchAction.mockResolvedValueOnce(page([hit(1)])).mockResolvedValueOnce(failure("DATABASE_ERROR"));
    await openSearch();
    type("invoice");
    await act(async () => submit());
    await act(async () => submit());
    expect(screen.getByRole("alert")).toHaveTextContent("Search could not be completed. Try again.");
    // A failed new search does not leave the previous results looking current.
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
    expect(searchAction).toHaveBeenCalledTimes(2);
  });

  it("lets a session redirect escape instead of rendering it", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    searchAction.mockRejectedValue(redirect);
    await openSearch();
    type("invoice");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await act(async () => submit());
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).toHaveBeenCalledWith(redirect, expect.anything());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("loads more results once per click with the exact cursor and the submitted query", async () => {
    searchAction.mockResolvedValueOnce(page([hit(5), hit(4)], true));
    await openSearch();
    type("invoice");
    await act(async () => submit());

    // Editing the box afterwards does not change what "more" means.
    type("something else");
    const more = deferred<SearchResult>();
    searchAction.mockReturnValueOnce(more.promise);
    const button = screen.getByRole("button", { name: "Load more results" });
    fireEvent.click(button);
    fireEvent.click(button);
    submit();
    expect(searchAction).toHaveBeenCalledTimes(2);
    expect(searchAction).toHaveBeenLastCalledWith({
      conversationId: id(1),
      query: "invoice",
      beforeCreatedAt: hit(4).createdAt,
      beforeMessageId: hit(4).messageId,
    });

    await act(async () => more.resolve(page([hit(3)])));
    expect(resultTimes()).toEqual([hit(5).createdAt, hit(4).createdAt, hit(3).createdAt]);
    expect(screen.queryByRole("button", { name: "Load more results" })).toBeNull();

    // A new search starts over.
    searchAction.mockResolvedValueOnce(page([hit(1)]));
    await act(async () => submit());
    expect(searchAction).toHaveBeenLastCalledWith({ conversationId: id(1), query: "something else" });
    expect(resultTimes()).toEqual([hit(1).createdAt]);
  });

  it("keeps results when loading more fails, and waits for another click", async () => {
    searchAction.mockResolvedValueOnce(page([hit(5)], true)).mockResolvedValueOnce(failure("RATE_LIMITED"));
    await openSearch();
    type("invoice");
    await act(async () => submit());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more results" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Too many searches. Try again shortly.");
    expect(resultTimes()).toEqual([hit(5).createdAt]);
    expect(screen.getByRole("button", { name: "Load more results" })).toBeEnabled();
    expect(searchAction).toHaveBeenCalledTimes(2);
  });

  it("drops a response for a search that was cleared while pending", async () => {
    const pending = deferred<SearchResult>();
    searchAction.mockReturnValueOnce(pending.promise);
    await openSearch();
    type("invoice");
    submit();
    type("");
    await act(async () => pending.resolve(page([hit(1)])));
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
    expect(searchStatus()).toHaveTextContent("");
  });

  it.each([
    ["success", () => page([hit(1, { snippet: "stale A result" })])],
    ["error", () => failure("RATE_LIMITED")],
  ])("never shows a late %s from the previous conversation", async (_label, late) => {
    const pending = deferred<SearchResult>();
    searchAction.mockReturnValueOnce(pending.promise);
    await openSearch();
    type("invoice");
    submit();

    // Switch to B and open its search box before A's search settles.
    await openConversation(2);
    if (!screen.queryByRole("search")) fireEvent.click(toggle());
    await act(async () => pending.resolve(late()));

    expect(screen.queryByText(/stale/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
    expect(searchStatus()).toHaveTextContent("");
    expect(input()).toHaveValue("");
    expect(searchAction).toHaveBeenCalledTimes(1);
  });

  it("Back discards the search; a double tap opens nothing and nothing reruns", async () => {
    searchAction.mockResolvedValue(page([hit(1)]));
    await openSearch();
    type("invoice");
    await act(async () => submit());
    expect(searchAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }), { detail: 1 });
    fireEvent.click(row(1), { detail: 2 });
    expect(detailAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("search")).toBeNull();

    await act(async () => fireEvent.click(row(1), { detail: 1 }));
    expect(detailAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("search")).toBeNull();
    fireEvent.click(toggle());
    expect(input()).toHaveValue("");
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
    expect(searchAction).toHaveBeenCalledTimes(1);
  });

  it("opens and closes without reading; Escape returns focus to the toggle", async () => {
    await openSearch();
    const button = screen.getByRole("button", { name: "Close search" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    // The tail of a double tap does not close it again.
    fireEvent.click(button, { detail: 2 });
    expect(screen.getByRole("search")).toBeInTheDocument();

    type("invoice");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(toggle()).toHaveFocus();
    fireEvent.click(toggle());
    expect(input()).toHaveValue("");
    expect(searchAction).not.toHaveBeenCalled();
  });

  it("offers no search before a transcript has loaded", () => {
    detailAction.mockReturnValue(new Promise(() => {}));
    renderWorkspace();
    expect(screen.queryByRole("button", { name: "Search this conversation" })).toBeNull();
    fireEvent.click(row(1));
    expect(screen.queryByRole("button", { name: "Search this conversation" })).toBeNull();
  });
});

describe("Supervised search boundary (source)", () => {
  const search = readFileSync("src/components/team-supervision/supervised-search.tsx", "utf8");
  const workspace = readFileSync("src/components/team-supervision/supervised-conversations-workspace.tsx", "utf8");

  it("calls only the search action, only from a submit or an explicit click", () => {
    expect(search.match(/\w+Action\b/g)).toEqual([
      "searchSupervisedConversationAction",
      "searchSupervisedConversationAction",
    ]);
    expect(search).not.toMatch(
      /supabase|team-supervision-(repository|service)|MessageWindow|useEffect|setInterval|setTimeout|IntersectionObserver|onScroll|addEventListener/,
    );
    expect(workspace).not.toMatch(/searchSupervised/);
  });

  it("keeps the query out of logs, storage and the URL", () => {
    expect(search).not.toMatch(
      /console\.|Sentry|captureException|localStorage|sessionStorage|indexedDB|URLSearchParams|useRouter|useSearchParams|history\.(push|replace)State|location\.|dangerouslySetInnerHTML|innerHTML/,
    );
  });
});

describe("Supervised search result jump", () => {
  type WindowResult = TeamSupervisionActionResult<SupervisedMessageWindow>;

  const target = (n: number) => msgId(200 + n);

  function hits(...ns: number[]): TeamSupervisionActionResult<SupervisedMessageSearchPage> {
    return {
      ok: true,
      data: {
        results: ns.map((n) => ({
          messageId: target(n),
          author: { profileId: "b-1", displayName: "John 1", avatarUrl: null },
          createdAt: `2026-09-01T0${n}:00:00+00:00`,
          snippet: `hit number ${n}`,
        })),
        hasMore: false,
        nextCursor: null,
      },
    };
  }

  function contextWindow(n: number, around: SupervisedMessage[] = []): WindowResult {
    const summary = conversation(1);
    return {
      ok: true,
      data: {
        found: true,
        conversationId: summary.conversationId,
        kind: "direct",
        createdAt: summary.createdAt,
        lastMessageAt: summary.lastMessageAt,
        participants: summary.participants,
        messages: [
          ...around,
          message(50 + n, { messageId: target(n), body: `Target body ${n}`, createdAt: "2026-09-02T11:30:00+00:00" }),
        ],
        hasMoreBefore: true,
        hasMoreAfter: false,
      },
    };
  }

  const result = (n: number) => document.querySelector<HTMLButtonElement>(`button[data-result-id="${target(n)}"]`)!;
  const returnButton = () => screen.getByRole("button", { name: "Return to conversation" });

  async function searchFor(...ns: number[]) {
    detailAction.mockResolvedValue(transcript(1, [message(1, { body: "Latest transcript" })], true));
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
    fireEvent.click(screen.getByRole("button", { name: "Search this conversation" }));
    searchAction.mockResolvedValue(hits(...ns));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hit" } });
    await act(async () => fireEvent.submit(screen.getByRole("search")));
  }

  it("reads no window until a result is deliberately activated, then exactly one", async () => {
    await searchFor(1, 2);
    fireEvent.mouseEnter(result(1));
    fireEvent.focus(result(1));
    fireEvent.pointerDown(result(1));
    fireEvent.mouseDown(result(1));
    fireEvent.touchStart(result(1));
    fireEvent.touchCancel(result(1));
    fireEvent.keyDown(result(1), { key: "ArrowDown" });
    expect(windowAction).not.toHaveBeenCalled();

    windowAction.mockResolvedValue(contextWindow(1));
    await act(async () => fireEvent.click(result(1)));
    expect(windowAction).toHaveBeenCalledTimes(1);
    expect(windowAction).toHaveBeenCalledWith({ conversationId: id(1), targetMessageId: target(1) });
    // A jump is not an open, a search or a history read.
    expect(detailAction).toHaveBeenCalledTimes(1);
    expect(searchAction).toHaveBeenCalledTimes(1);
    expect(historyAction).not.toHaveBeenCalled();
  });

  it("makes one call for a double tap, rapid Enter or mouse plus keyboard while pending", async () => {
    await searchFor(1, 2);
    const pending = deferred<WindowResult>();
    windowAction.mockReturnValue(pending.promise);
    fireEvent.click(result(1), { detail: 1 });
    fireEvent.click(result(1), { detail: 2 });
    fireEvent.click(result(1), { detail: 0 });
    fireEvent.click(result(1), { detail: 0 });
    // A tail that lands on the neighbouring result is not a selection either.
    fireEvent.click(result(2), { detail: 2 });
    expect(windowAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Loading message context" })).toBeInTheDocument();
    await act(async () => pending.resolve(contextWindow(1)));

    // Already showing it: selecting it again reads nothing; another result is a new read.
    fireEvent.click(result(1));
    expect(windowAction).toHaveBeenCalledTimes(1);
    windowAction.mockResolvedValue(contextWindow(2));
    await act(async () => fireEvent.click(result(2)));
    expect(windowAction).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Target body 2")).toBeInTheDocument();
  });

  it("shows the bounded window with the target marked, in place of the transcript", async () => {
    await searchFor(1);
    windowAction.mockResolvedValue(
      contextWindow(1, [
        message(2, { body: "HIDDEN CANONICAL" }),
        message(3, { body: "Message deleted", deletion: { deletedAt: null, deletedByProfileId: null, deletedByName: null } }),
        message(4, {
          messageType: "voice",
          body: "Voice message",
          supervisoryNotice: "Unavailable in supervisory view",
          reactions: [{ reactionCode: "like", count: 2 }],
        }),
        message(5, {
          forwarded: true,
          forwardedFromAuthorName: "Liam",
          reply: {
            messageId: msgId(1),
            authorProfileId: "b-1",
            authorName: "John 1",
            authorAvatarUrl: null,
            body: "Earlier",
            messageType: "text",
            deletedForEveryone: false,
          },
        }),
      ]),
    );
    await act(async () => fireEvent.click(result(1)));

    expect(screen.getByText("Search result in context")).toBeInTheDocument();
    expect(screen.queryByText("Latest transcript")).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "Load older messages" })).toBeNull();
    const marked = document.querySelector('[aria-current="true"][data-message-id]')!;
    expect(marked).toHaveAttribute("data-message-id", target(1));
    expect(marked).toHaveTextContent("Matched message");
    expect(marked).toHaveTextContent("Target body 1");
    expect(document.querySelectorAll('[data-message-id][aria-current="true"]')).toHaveLength(1);
    expect(screen.getByText("Earlier messages not shown")).toBeInTheDocument();
    expect(screen.queryByText("Later messages not shown")).toBeNull();

    // The same safe rendering as the transcript.
    expect(screen.getByText("HIDDEN CANONICAL")).toBeInTheDocument();
    expect(screen.getByText("Unavailable in supervisory view")).toBeInTheDocument();
    expect(screen.getByText(/Forwarded from Liam/)).toBeInTheDocument();
    expect(screen.getByText("Replying to John 1")).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: /Anthony 1/ });
    expect(panel.querySelector("audio, video, source, a[download]")).toBeNull();
    expect(panel.innerHTML).not.toMatch(/\.webm|storage|signed|reactedByMe|\bhidden for\b/i);
  });

  it("returns to the retained transcript without reading anything", async () => {
    await searchFor(1);
    historyAction.mockResolvedValue(transcript(1, [message(0, { body: "Older history kept" })]));
    // Load older first, so there is fetched state worth keeping.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load older messages" })));
    expect(historyAction).toHaveBeenCalledTimes(1);

    windowAction.mockResolvedValue(contextWindow(1));
    await act(async () => fireEvent.click(result(1)));
    const calls = () => [detailAction, searchAction, historyAction, windowAction].map((fn) => fn.mock.calls.length);
    const before = calls();

    fireEvent.click(returnButton(), { detail: 1 });
    expect(screen.queryByText("Search result in context")).toBeNull();
    expect(screen.getByText("Latest transcript")).toBeVisible();
    expect(screen.getByText("Older history kept")).toBeVisible();
    // The results are still there to pick another; nothing searched again.
    expect(result(1)).toBeInTheDocument();
    expect(result(1)).not.toHaveAttribute("aria-current");
    expect(calls()).toEqual(before);

    // Re-selecting after returning is a new deliberate read.
    await act(async () => fireEvent.click(result(1)));
    expect(windowAction).toHaveBeenCalledTimes(2);
  });

  it("the tail of a double tap on Return does not load older history", async () => {
    await searchFor(1);
    windowAction.mockResolvedValue(contextWindow(1));
    await act(async () => fireEvent.click(result(1)));
    fireEvent.click(returnButton(), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }), { detail: 2 });
    expect(historyAction).not.toHaveBeenCalled();
  });

  it.each([
    ["success", () => contextWindow(1)],
    ["error", (): WindowResult => ({ ok: false, error: { code: "DATABASE_ERROR", message: "x" } })],
  ])("drops a late %s for a result that is no longer selected", async (_label, late) => {
    await searchFor(1, 2);
    const first = deferred<WindowResult>();
    const second = deferred<WindowResult>();
    windowAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    fireEvent.click(result(1));
    fireEvent.click(result(2));
    expect(windowAction).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve(late()));
    expect(screen.queryByText("Target body 1")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading message context" })).toBeInTheDocument();
    expect(result(2)).toHaveAttribute("aria-current", "true");

    await act(async () => second.resolve(contextWindow(2)));
    expect(screen.getByText("Target body 2")).toBeInTheDocument();
    expect(screen.queryByText("Target body 1")).toBeNull();
  });

  it("drops a late window after switching conversation or going Back", async () => {
    await searchFor(1);
    const late = deferred<WindowResult>();
    windowAction.mockReturnValueOnce(late.promise);
    fireEvent.click(result(1));
    detailAction.mockResolvedValue(transcript(2, [message(2, { body: "From B" })]));
    await act(async () => fireEvent.click(row(2)));
    await act(async () => late.resolve(contextWindow(1)));
    expect(screen.getByText("From B")).toBeVisible();
    expect(screen.queryByText("Target body 1")).toBeNull();
    expect(screen.queryByText("Search result in context")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();

    // Back while a window is pending: nothing arrives afterwards either.
    fireEvent.click(screen.getByRole("button", { name: "Search this conversation" }));
    searchAction.mockResolvedValue(hits(1));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hit" } });
    await act(async () => fireEvent.submit(screen.getByRole("search")));
    const lateBack = deferred<WindowResult>();
    windowAction.mockReturnValueOnce(lateBack.promise);
    fireEvent.click(result(1));
    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }), { detail: 1 });
    fireEvent.click(row(2), { detail: 2 });
    await act(async () => lateBack.resolve(contextWindow(1)));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("Target body 1")).toBeNull();
    expect(windowAction).toHaveBeenCalledTimes(2);
    expect(detailAction).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a missing or foreign target", (): WindowResult => ({ ok: true, data: { found: false } })],
    ["an ineligible conversation", (): WindowResult => ({ ok: false, error: { code: "NOT_FOUND", message: "x" } })],
  ])("shows one unavailable state for %s, with no retry", async (_label, response) => {
    await searchFor(1);
    windowAction.mockResolvedValue(response());
    await act(async () => fireEvent.click(result(1)));
    expect(screen.getByRole("alert")).toHaveTextContent("This message is unavailable.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.querySelector("[aria-current='true'][data-message-id]")).toBeNull();
    // Selecting it again does not loop.
    fireEvent.click(result(1));
    expect(windowAction).toHaveBeenCalledTimes(1);
  });

  it("retries a generic failure only on a deliberate click, once per click", async () => {
    await searchFor(1);
    windowAction.mockResolvedValueOnce({ ok: false, error: { code: "DATABASE_ERROR", message: "x" } });
    await act(async () => fireEvent.click(result(1)));
    expect(screen.getByRole("alert")).toHaveTextContent("This message could not be loaded.");
    expect(screen.getByRole("alert").textContent).not.toMatch(/database|rpc|sql/i);
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(windowAction).toHaveBeenCalledTimes(1);

    const retry = deferred<WindowResult>();
    windowAction.mockReturnValueOnce(retry.promise);
    const button = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(windowAction).toHaveBeenCalledTimes(2);
    await act(async () => retry.resolve(contextWindow(1)));
    expect(screen.getByText("Target body 1")).toBeInTheDocument();
  });

  it("lets a session redirect escape instead of rendering it", async () => {
    await searchFor(1);
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    windowAction.mockRejectedValue(redirect);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await act(async () => fireEvent.click(result(1)));
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).toHaveBeenCalledWith(redirect, expect.anything());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closing search leaves the window; the query never reaches the window action", async () => {
    await searchFor(1);
    windowAction.mockResolvedValue(contextWindow(1));
    await act(async () => fireEvent.click(result(1)));
    expect(JSON.stringify(windowAction.mock.calls)).not.toContain("hit");
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByText("Search result in context")).toBeNull();
    expect(screen.getByText("Latest transcript")).toBeVisible();
    expect(windowAction).toHaveBeenCalledTimes(1);
  });
});

describe("Supervised controlled refresh", () => {
  type DetailResult = TeamSupervisionActionResult<SupervisedTranscriptPage>;

  const bodies = () => [...document.querySelectorAll("[data-transcript] [data-message-id]")].map((node) => node.textContent);
  const refreshButton = () => screen.getByRole("button", { name: /Refresh latest|Refreshing/ });
  const checked = () => screen.getByText(/Last checked/).querySelector("time")!.getAttribute("datetime");

  async function openAt(iso: string, page: DetailResult) {
    vi.setSystemTime(new Date(iso));
    detailAction.mockResolvedValueOnce(page);
    renderWorkspace();
    await act(async () => fireEvent.click(row(1)));
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("reads nothing until clicked, then once per click; Last checked moves only on success", async () => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10), message(11)], true));
    expect(checked()).toBe("2026-09-02T12:00:00.000Z");
    fireEvent.mouseEnter(refreshButton());
    fireEvent.focus(refreshButton());
    fireEvent.pointerDown(refreshButton());
    expect(detailAction).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-09-02T12:05:00Z"));
    const pending = deferred<DetailResult>();
    detailAction.mockReturnValueOnce(pending.promise);
    fireEvent.click(refreshButton(), { detail: 1 });
    fireEvent.click(refreshButton(), { detail: 2 });
    fireEvent.click(refreshButton(), { detail: 0 });
    expect(detailAction).toHaveBeenCalledTimes(2);
    expect(detailAction).toHaveBeenLastCalledWith({ conversationId: id(1) });
    expect(refreshButton()).toBeDisabled();
    expect(checked()).toBe("2026-09-02T12:00:00.000Z");

    await act(async () => pending.resolve(transcript(1, [message(11), message(12)], true)));
    expect(checked()).toBe("2026-09-02T12:05:00.000Z");
    expect(refreshButton()).toBeEnabled();
    // The tail of a double tap that outlives the read is not a second refresh.
    fireEvent.click(refreshButton(), { detail: 2 });
    expect(detailAction).toHaveBeenCalledTimes(2);
    expect(historyAction).not.toHaveBeenCalled();
    expect(searchAction).not.toHaveBeenCalled();
    expect(windowAction).not.toHaveBeenCalled();
  });

  it("merges the fresh latest page into loaded history instead of replacing it", async () => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10), message(11), message(12)], true));
    historyAction.mockResolvedValueOnce(transcript(1, [message(8), message(9)], true));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load older messages" })));
    expect(bodies()).toEqual(["Message 8", "Message 9", "Message 10", "Message 11", "Message 12"]);

    // Fresh page: 11 is now a tombstone, 12 changed, 13 is new. 10 fell off its start.
    detailAction.mockResolvedValueOnce(
      transcript(
        1,
        [
          message(11, { body: "Message deleted", deletion: { deletedAt: null, deletedByProfileId: null, deletedByName: null } }),
          message(12, { body: "Message 12 fresh" }),
          message(13),
        ],
        true,
      ),
    );
    await act(async () => fireEvent.click(refreshButton()));
    expect(bodies()).toEqual(["Message 8", "Message 9", "Message 10", "Message deleted", "Message 12 fresh", "Message 13"]);
    expect(screen.queryByText("Message 11")).toBeNull();

    // Load older continues from the oldest loaded row, not from the fresh page.
    historyAction.mockResolvedValueOnce(transcript(1, [message(7)], false));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load older messages" })));
    expect(historyAction).toHaveBeenLastCalledWith({
      conversationId: id(1),
      beforeCreatedAt: message(8).createdAt,
      beforeMessageId: msgId(8),
    });
    expect(bodies()[0]).toBe("Message 7");
  });

  it("reconciles by id and keyset order, replacing only when the fresh page is whole or disjoint", () => {
    const loaded = [message(8), message(9), message(10), message(11)];
    const cursor = { beforeCreatedAt: message(8).createdAt, beforeMessageId: msgId(8) };
    const page = (messages: SupervisedMessage[], more: boolean) =>
      (transcript(1, messages, more) as { data: SupervisedTranscriptPage }).data;

    const merged = reconcileLatest(loaded, cursor, page([message(10, { body: "new 10" }), message(11), message(12)], true));
    expect(merged.messages.map((m) => m.body)).toEqual(["Message 8", "Message 9", "new 10", "Message 11", "Message 12"]);
    expect(merged.cursor).toEqual(cursor);

    // Same timestamp: the id breaks the tie, as in the RPC keyset.
    const tie = message(9, { messageId: msgId(99), createdAt: message(10).createdAt });
    expect(
      reconcileLatest([message(8), tie, message(10)], cursor, page([message(10)], true)).messages.map((m) => m.messageId),
    ).toEqual([msgId(8), msgId(10)]);

    // Everything the conversation has: the fresh page is authoritative.
    expect(reconcileLatest(loaded, cursor, page([message(11), message(12)], false))).toEqual({
      messages: [message(11), message(12)],
      cursor: null,
    });
    // More new rows than one page: no overlap, so older rows would sit behind a gap.
    const gap = reconcileLatest(loaded, cursor, page([message(30), message(31)], true));
    expect(gap.messages.map((m) => m.messageId)).toEqual([msgId(30), msgId(31)]);
    expect(gap.cursor).toEqual({ beforeCreatedAt: message(30).createdAt, beforeMessageId: msgId(30) });
    // Nothing older than the fresh page was loaded: the fresh cursor applies.
    expect(reconcileLatest([message(11)], null, page([message(11), message(12)], true)).cursor).toEqual({
      beforeCreatedAt: message(11).createdAt,
      beforeMessageId: msgId(11),
    });
  });

  it("scrolls to the latest message after a refresh", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10)], false));
      scrolled.mockClear();
      detailAction.mockResolvedValueOnce(transcript(1, [message(10), message(11)], false));
      await act(async () => fireEvent.click(refreshButton()));
      expect(scrolled).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("never runs refresh and Load older at the same time", async () => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10)], true));
    const refresh = deferred<DetailResult>();
    detailAction.mockReturnValueOnce(refresh.promise);
    fireEvent.click(refreshButton());
    const older = screen.getByRole("button", { name: "Load older messages" });
    expect(older).toBeDisabled();
    fireEvent.click(older);
    expect(historyAction).not.toHaveBeenCalled();
    await act(async () => refresh.resolve(transcript(1, [message(10)], true)));

    const history = deferred<DetailResult>();
    historyAction.mockReturnValueOnce(history.promise);
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(refreshButton()).toBeDisabled();
    fireEvent.click(refreshButton());
    expect(detailAction).toHaveBeenCalledTimes(2);
    await act(async () => history.resolve(transcript(1, [message(9)], false)));
    expect(refreshButton()).toBeEnabled();
  });

  it("keeps the transcript on a generic failure and retries only when clicked", async () => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10)], false));
    vi.setSystemTime(new Date("2026-09-02T12:05:00Z"));
    detailAction.mockResolvedValueOnce({ ok: false, error: { code: "DATABASE_ERROR", message: "row 42 failed" } });
    await act(async () => fireEvent.click(refreshButton()));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't refresh. Try again.");
    expect(document.body.textContent).not.toMatch(/row 42|database/i);
    expect(bodies()).toEqual(["Message 10"]);
    expect(checked()).toBe("2026-09-02T12:00:00.000Z");
    expect(detailAction).toHaveBeenCalledTimes(2);

    detailAction.mockResolvedValueOnce(transcript(1, [message(10), message(11)], false));
    await act(async () => fireEvent.click(refreshButton()));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(bodies()).toEqual(["Message 10", "Message 11"]);
    expect(checked()).toBe("2026-09-02T12:05:00.000Z");
  });

  it.each([
    ["NOT_FOUND", "This conversation is unavailable."],
    ["PERMISSION_DENIED", "You don't have access to this view."],
  ] as const)("clears the transcript, search and window when refresh returns %s", async (code, copy) => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10, { body: "Privileged body" })], true));
    fireEvent.click(screen.getByRole("button", { name: "Search this conversation" }));
    detailAction.mockResolvedValueOnce({ ok: false, error: { code, message: "x" } });
    await act(async () => fireEvent.click(refreshButton()));
    expect(screen.getByRole("alert")).toHaveTextContent(copy);
    expect(screen.queryByText("Privileged body")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByText(/Last checked/)).toBeNull();
    expect(detailAction).toHaveBeenCalledTimes(2);
    // Reopening is a deliberate new read, not a loop.
    detailAction.mockResolvedValueOnce(transcript(1, [message(10, { body: "Reopened" })]));
    await act(async () => fireEvent.click(row(1)));
    expect(screen.getByText("Reopened")).toBeInTheDocument();
  });

  it("does not rerun or clear search, and stays hidden while a context window is shown", async () => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10, { body: "Old latest" })], true));
    fireEvent.click(screen.getByRole("button", { name: "Search this conversation" }));
    searchAction.mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            messageId: msgId(10),
            author: { profileId: "a-1", displayName: "Anthony 1", avatarUrl: null },
            createdAt: message(10).createdAt,
            snippet: "hit",
          },
        ],
        hasMore: false,
        nextCursor: null,
      },
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hit" } });
    await act(async () => fireEvent.submit(screen.getByRole("search")));

    const pending = deferred<DetailResult>();
    detailAction.mockReturnValueOnce(pending.promise);
    fireEvent.click(refreshButton());
    const base = (transcript(1, [message(10, { body: "Window row" })]) as { data: SupervisedTranscriptPage }).data;
    windowAction.mockResolvedValue({ ok: true, data: { ...base, found: true, hasMoreBefore: false, hasMoreAfter: false } });
    await act(async () => fireEvent.click(document.querySelector<HTMLButtonElement>("[data-result-id]")!));
    expect(screen.queryByRole("button", { name: /Refresh latest|Refreshing/ })).toBeNull();
    expect(screen.queryByText(/Last checked/)).not.toBeVisible();

    // The pending refresh lands behind the window: the window stays, the hidden transcript updates.
    await act(async () => pending.resolve(transcript(1, [message(10), message(11, { body: "New latest" })], false)));
    expect(screen.getByText("Window row")).toBeVisible();
    expect(screen.getByText("New latest")).not.toBeVisible();
    expect(searchAction).toHaveBeenCalledTimes(1);
    expect(windowAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-result-id]")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Return to conversation" }));
    expect(screen.getByText("New latest")).toBeVisible();
    expect(refreshButton()).toBeEnabled();
    expect(searchAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["success", (): DetailResult => transcript(1, [message(10, { body: "Late A" })])],
    ["unavailable", (): DetailResult => ({ ok: false, error: { code: "NOT_FOUND", message: "x" } })],
    ["error", (): DetailResult => ({ ok: false, error: { code: "DATABASE_ERROR", message: "x" } })],
  ])("drops a late %s after switching conversation or going Back", async (_label, late) => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10)], true));
    const first = deferred<DetailResult>();
    detailAction.mockReturnValueOnce(first.promise);
    fireEvent.click(refreshButton());
    detailAction.mockResolvedValueOnce(transcript(2, [message(20, { body: "From B" })]));
    await act(async () => fireEvent.click(row(2)));
    await act(async () => first.resolve(late()));
    expect(screen.getByText("From B")).toBeVisible();
    expect(screen.queryByText("Late A")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    const second = deferred<DetailResult>();
    detailAction.mockReturnValueOnce(second.promise);
    fireEvent.click(refreshButton());
    fireEvent.click(screen.getByRole("button", { name: "Back to conversations" }));
    await act(async () => second.resolve(late()));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(detailAction).toHaveBeenCalledTimes(4);
  });

  it("lets a session redirect escape instead of rendering it", async () => {
    await openAt("2026-09-02T12:00:00Z", transcript(1, [message(10)], false));
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    detailAction.mockRejectedValueOnce(redirect);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await act(async () => fireEvent.click(refreshButton()));
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).toHaveBeenCalledWith(redirect, expect.anything());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps Last checked local: no storage, logs, timers or automatic reads (source)", () => {
    const source = readFileSync("src/components/team-supervision/supervised-transcript.tsx", "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|console\.|Sentry|history\.|searchParams|setInterval|setTimeout|requestAnimationFrame/);
    // One import, one call: the click handler.
    expect(source.match(/getSupervisedConversationAction/g)).toHaveLength(2);
  });
});
