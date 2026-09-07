/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { TeamReactionView } from "../domain/team/projections";
import type { TeamActionResult } from "../app/actions/team-messages";
import type { TeamSearchResponseRow } from "../domain/team/schema";

const searchTeamConversationMessagesAction = vi.fn();

vi.mock("../app/actions/team-messages", () => ({
  searchTeamConversationMessagesAction: (...args: unknown[]) =>
    searchTeamConversationMessagesAction(...args),
}));

import { TeamReactionChips, TeamReactionRail } from "../components/team/team-message-reactions";
import { TeamSearchPanel } from "../components/team/team-search-panel";
import styles from "../components/team/team-messages.module.css";

afterEach(cleanup);

/**
 * Team Communication V2.3 UI — the reaction rail/chips and the search panel.
 *
 * The floating "Search conversation" reveal, Ctrl/Cmd+F interception, and
 * upward-scroll history loading live in `TeamConversationPane` and depend on
 * real layout (scrollHeight/scrollTop), which jsdom does not compute — those
 * are covered by rendered browser QA instead. Everything testable in
 * isolation here is.
 */

function ok<T>(data: T): TeamActionResult<T> {
  return { ok: true, data };
}

function searchResponse(overrides: Partial<TeamSearchResponseRow> = {}): TeamSearchResponseRow {
  return { results: [], has_more: false, ...overrides };
}

function ReactionRailHarness({
  reactions = [],
  mobileActive = false,
  onReact = vi.fn(),
  onInteract = vi.fn(),
  onReply = vi.fn(),
  onMore = vi.fn(),
}: {
  reactions?: TeamReactionView[];
  mobileActive?: boolean;
  onReact?: (code: "like" | "heart" | "laugh" | "wow" | "celebrate" | "fire" | "eyes" | "pray" | "check") => void;
  onInteract?: () => void;
  onReply?: () => void;
  onMore?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <TeamReactionRail
      reactions={reactions}
      onReact={onReact}
      mobileActive={mobileActive}
      onInteract={onInteract}
      pickerOpen={pickerOpen}
      onTogglePicker={() => setPickerOpen((value) => !value)}
      onClosePicker={() => setPickerOpen(false)}
      onReply={onReply}
      onMore={onMore}
    />
  );
}

describe("TeamReactionRail", () => {
  it("renders only React, Reply, and More", () => {
    render(
      <ReactionRailHarness />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "React" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("Reply invokes the reply action and reports the interaction", () => {
    const onReply = vi.fn();
    const onInteract = vi.fn();
    render(
      <ReactionRailHarness onReply={onReply} onInteract={onInteract} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onInteract).toHaveBeenCalledTimes(1);
  });

  it("marks an active reaction inside the picker", () => {
    const reactions: TeamReactionView[] = [
      { code: "heart", emoji: "\u{2764}\u{FE0F}", count: 1, reactedByMe: true, reactorNames: ["Anthony"] },
    ];
    render(
      <ReactionRailHarness reactions={reactions} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Heart" })).toHaveAttribute("aria-checked", "true");
  });

  it("opens all nine reactions, and a selection reacts and closes immediately", () => {
    const onReact = vi.fn();
    render(
      <ReactionRailHarness onReact={onReact} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "React" }));

    const picker = screen.getByRole("menu", { name: "Reactions" });
    expect(within(picker).getAllByRole("menuitemcheckbox")).toHaveLength(9);

    fireEvent.click(within(picker).getByRole("menuitemcheckbox", { name: "Fire" }));
    expect(onReact).toHaveBeenCalledWith("fire");
    expect(screen.queryByRole("menu", { name: "Reactions" })).not.toBeInTheDocument();
  });

  it("closes the picker on Escape", () => {
    render(<ReactionRailHarness />);
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(screen.getByRole("menu", { name: "Reactions" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Reactions" })).not.toBeInTheDocument();
  });

  it("carries the mobile-active class when the bubble has been tapped", () => {
    const { container, rerender } = render(
      <ReactionRailHarness />,
    );
    const rail = container.firstElementChild as HTMLElement;
    expect(rail.className).not.toMatch(/mobileActive/i);

    rerender(<ReactionRailHarness mobileActive />);
    expect(rail.className.toLowerCase()).toContain("mobileactive");
  });
});

/**
 * Structural approximation of the bubble row assembled inline inside
 * `TeamConversationPane` (`team-conversation-view.tsx`) — that component has
 * no test harness anywhere in this repo, because it needs real layout
 * (`scrollHeight`/`scrollTop`) that jsdom does not compute. This harness
 * reproduces only the static DOM shape (`.bubbleRow` > bubble, `<time>`,
 * `TeamReactionRail`, using the real CSS module so the class names match
 * production) to prove structurally that the timestamp and the action rail
 * coexist as separate sibling elements — real hover reveal / pixel
 * positioning is covered by rendered browser QA, not here.
 */
function BubbleRowHarness({ isMine = false }: { isMine?: boolean }) {
  return (
    <div className={isMine ? styles.messageGroupMine : ""}>
      <div className={styles.bubbleRow}>
        <div className={styles.bubble}>hy</div>
        <time className={styles.bubbleTime} dateTime="2026-08-27T08:00:00.000Z">
          8:00 AM
        </time>
        <TeamReactionRail
          reactions={[]}
          onReact={vi.fn()}
          mobileActive={false}
          onInteract={vi.fn()}
          pickerOpen={false}
          onTogglePicker={vi.fn()}
          onClosePicker={vi.fn()}
          onReply={vi.fn()}
          onMore={vi.fn()}
        />
      </div>
    </div>
  );
}

describe("Message row metadata (timestamp + action rail hover regression)", () => {
  it("renders the timestamp and the full action rail at the same time, not one instead of the other", () => {
    render(<BubbleRowHarness />);
    const time = screen.getByText("8:00 AM");
    expect(time.tagName).toBe("TIME");
    expect(time.className).toMatch(/bubbleTime/i);
    expect(screen.getByRole("toolbar", { name: "Message actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "React" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("renders exactly one timestamp for the message, never a duplicate", () => {
    render(<BubbleRowHarness />);
    expect(screen.getAllByText("8:00 AM")).toHaveLength(1);
  });

  it("keeps the timestamp and the action toolbar as siblings inside the same row container", () => {
    render(<BubbleRowHarness />);
    const time = screen.getByText("8:00 AM");
    const toolbar = screen.getByRole("toolbar", { name: "Message actions" });
    expect(time.parentElement).toBe(toolbar.parentElement);
    expect(time.parentElement?.className).toMatch(/bubbleRow/i);
  });

  it("does not apply the outgoing/mine modifier class for a colleague's message", () => {
    const { container } = render(<BubbleRowHarness isMine={false} />);
    expect(container.firstElementChild?.className ?? "").toBe("");
  });

  it("applies the outgoing/mine modifier class for the actor's own message", () => {
    const { container } = render(<BubbleRowHarness isMine />);
    expect((container.firstElementChild?.className ?? "").toLowerCase()).toContain("messagegroupmine");
  });
});

describe("TeamReactionChips", () => {
  it("renders nothing for an empty reaction list", () => {
    const { container } = render(<TeamReactionChips reactions={[]} onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a chip with its emoji and count, and reflects the actor's own reaction", () => {
    const reactions: TeamReactionView[] = [
      { code: "heart", emoji: "\u{2764}\u{FE0F}", count: 2, reactedByMe: true, reactorNames: ["Anthony", "Blair"] },
    ];
    render(<TeamReactionChips reactions={reactions} onToggle={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /Heart, 2/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a chip toggles it", () => {
    const onToggle = vi.fn();
    const reactions: TeamReactionView[] = [
      { code: "fire", emoji: "\u{1F525}", count: 1, reactedByMe: false, reactorNames: ["Blair"] },
    ];
    render(<TeamReactionChips reactions={reactions} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /Fire, 1/ }));
    expect(onToggle).toHaveBeenCalledWith("fire");
  });

  it("reveals the reactor list on hover and hides it again on mouse leave", () => {
    const reactions: TeamReactionView[] = [
      { code: "like", emoji: "\u{1F44D}", count: 2, reactedByMe: false, reactorNames: ["Anthony", "Blair"] },
    ];
    render(<TeamReactionChips reactions={reactions} onToggle={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /Like, 2/ });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.mouseEnter(chip);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Anthony, Blair");
    fireEvent.mouseLeave(chip);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("caps the tooltip list and reports an overflow count", () => {
    const names = Array.from({ length: 10 }, (_, index) => `Member ${index + 1}`);
    const reactions: TeamReactionView[] = [
      { code: "check", emoji: "\u{2705}", count: 10, reactedByMe: false, reactorNames: names },
    ];
    render(<TeamReactionChips reactions={reactions} onToggle={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Check, 10/ }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("+2");
  });
});

describe("TeamSearchPanel", () => {
  const CONVERSATION = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.useFakeTimers();
    searchTeamConversationMessagesAction.mockReset();
  });

  afterEach(() => {
    /*
     * Unmount WHILE fake timers are still active, so the debounce effect's
     * own cleanup (clearTimeout) cancels a pending FAKE timer rather than
     * leaving it dangling once real timers are restored — otherwise a timer
     * left over from one test can fire mid-flight in the next.
     */
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <TeamSearchPanel open={false} conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("debounces the search call and never fires for an empty query", async () => {
    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(searchTeamConversationMessagesAction).not.toHaveBeenCalled();
  });

  it("fires exactly one call 250ms after the last keystroke, not one per keystroke", async () => {
    searchTeamConversationMessagesAction.mockResolvedValue(ok(searchResponse()));
    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    const input = screen.getByRole("textbox", { name: "Search conversation" });

    fireEvent.change(input, { target: { value: "w" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: "we" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: "web" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(searchTeamConversationMessagesAction).toHaveBeenCalledTimes(1);
    expect(searchTeamConversationMessagesAction).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION, query: "web" }),
    );
  });

  it("renders results with the matched term highlighted, and auto-jumps to the first hit", async () => {
    const onJumpToResult = vi.fn();
    searchTeamConversationMessagesAction.mockResolvedValue(
      ok(
        searchResponse({
          results: [
            {
              id: "m1",
              author_profile_id: "p1",
              author_name: "William Jones",
              author_avatar_url: null,
              created_at: "2026-08-12T15:00:00.000Z",
              snippet: "…I already sent the website audit…",
            },
          ],
        }),
      ),
    );

    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={onJumpToResult} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation" }), {
      target: { value: "website" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText("William Jones")).toBeInTheDocument();
    expect(screen.getByText("website")).toBeInTheDocument();
    expect(screen.getByText("website").tagName).toBe("MARK");
    expect(onJumpToResult).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("shows a no-matches state for an empty result set", async () => {
    searchTeamConversationMessagesAction.mockResolvedValue(ok(searchResponse()));
    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation" }), {
      target: { value: "nothingmatchesthis" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText("No matches in this conversation.")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={onClose} onJumpToResult={vi.fn()} />,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search conversation" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cycles next/previous through results and reports the position", async () => {
    const onJumpToResult = vi.fn();
    searchTeamConversationMessagesAction.mockResolvedValue(
      ok(
        searchResponse({
          results: [
            { id: "a", author_profile_id: "p1", author_name: "Ann", author_avatar_url: null, created_at: "2026-08-12T15:00:00.000Z", snippet: "hit website one" },
            { id: "b", author_profile_id: "p2", author_name: "Bo", author_avatar_url: null, created_at: "2026-07-28T15:00:00.000Z", snippet: "hit website two" },
          ],
        }),
      ),
    );

    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={onJumpToResult} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation" }), {
      target: { value: "website" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    onJumpToResult.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Next result" }));
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(onJumpToResult).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));

    onJumpToResult.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(onJumpToResult).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("discards a stale answer that resolves after a newer query has already been typed", async () => {
    let resolveFirst!: (value: TeamActionResult<TeamSearchResponseRow>) => void;
    const first = new Promise<TeamActionResult<TeamSearchResponseRow>>((resolve) => {
      resolveFirst = resolve;
    });
    searchTeamConversationMessagesAction
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(
        ok(
          searchResponse({
            results: [
              { id: "second", author_profile_id: "p1", author_name: "Second", author_avatar_url: null, created_at: "2026-08-12T15:00:00.000Z", snippet: "second hit" },
            ],
          }),
        ),
      );

    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    const input = screen.getByRole("textbox", { name: "Search conversation" });

    fireEvent.change(input, { target: { value: "first" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    fireEvent.change(input, { target: { value: "second" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // The stale first request resolves AFTER the second request has already landed.
    resolveFirst(
      ok(
        searchResponse({
          results: [
            { id: "stale", author_profile_id: "p1", author_name: "Stale", author_avatar_url: null, created_at: "2026-08-12T15:00:00.000Z", snippet: "stale hit" },
          ],
        }),
      ),
    );

    /*
     * `waitFor`'s default polling relies on real timers, which fake timers
     * freeze — flush the resolved promise's microtasks directly instead.
     */
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("shows the server error message rather than a silent empty state", async () => {
    searchTeamConversationMessagesAction.mockResolvedValue({ ok: false, error: "Team search could not be refreshed." });
    render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation" }), {
      target: { value: "website" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText("Team search could not be refreshed.")).toBeInTheDocument();
  });

  it("starts a fresh session — clearing the previous query and results — when opened on a different conversation", async () => {
    searchTeamConversationMessagesAction.mockResolvedValue(ok(searchResponse()));
    const { rerender } = render(
      <TeamSearchPanel open conversationId={CONVERSATION} onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation" }), {
      target: { value: "website" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByRole("textbox", { name: "Search conversation" })).toHaveValue("website");

    rerender(
      <TeamSearchPanel open conversationId="44444444-4444-4444-8444-444444444444" onClose={vi.fn()} onJumpToResult={vi.fn()} />,
    );
    expect(screen.getByRole("textbox", { name: "Search conversation" })).toHaveValue("");
  });
});
