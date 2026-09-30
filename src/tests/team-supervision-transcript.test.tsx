/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSupervisionActionResult } from "../app/actions/team-supervision";
import * as supervisionActions from "../app/actions/team-supervision";
import { SupervisedConversationsWorkspace } from "../components/team-supervision/supervised-conversations-workspace";
import type {
  SupervisedConversationSummary,
  SupervisedMessage,
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
    const controls = within(panel).queryAllByRole("button").map((button) => button.textContent);
    expect(controls).toEqual(["Back"]);
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
    detailAction.mockResolvedValue(transcript(1, [message(1)]));
    await act(async () => fireEvent.click(within(alert).getByRole("button", { name: "Try again" })));
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
      /supabase|team-supervision-(repository|service)|next-server|server-only|searchSupervised|MessageWindow|team-live|setInterval|setTimeout|visibilitychange|addEventListener\(["']focus|useEffect|IntersectionObserver|next\/link|router\.prefetch/,
    );
    expect(source).not.toMatch(/catch/);
  });

  it("reuses only pure Team visuals", () => {
    const imports = source.match(/^import [\s\S]*?;$/gm)?.join("\n") ?? "";
    expect(imports).not.toMatch(
      /team-messages-drawer|team-conversation-view|team-presence|use-team|team-rich-composer|team-message-actions|team-message-reactions|team-voice|team-task|team-pins|team-http-client/,
    );
    expect(source).not.toMatch(/markRead|presence=|reactedByMe|storagePath|signedUrl/);
  });
});
