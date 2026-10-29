"use client";

import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { stripTeamFormatting } from "../../domain/team/formatting";
import {
  formatTeamDayHeading,
  formatTeamMessageTime,
  teamActivityLabel,
  teamTypingLabel,
  type TeamConversationDetailView,
  type TeamConversationView,
  type TeamMemberView,
  type TeamSearchResultView,
  type TeamMessageView,
} from "../../domain/team/projections";
import {
  teamMessageMaxLength,
  teamReplyQuoteMaxLength,
  type TeamConversationCapability,
  type TeamReactionCode,
  type TeamSlowModeScope,
  type TeamTaskCreationPolicy,
  type TeamTaskStatus,
} from "../../domain/team/schema";
import dynamic from "next/dynamic";
import { TeamAvatar } from "./team-avatar";
import { TeamConversationAvatar } from "./team-conversation-avatar";
import { formatSlowModeSeconds, TeamConversationControls } from "./team-conversation-controls";
import { TeamFormattedMessage } from "./team-formatted-message";
import { TeamMessageActions } from "./team-message-actions";
import { TeamPinsPanel } from "./team-pins-panel";
import { TeamReactionChips, TeamReactionRail } from "./team-message-reactions";
import { TeamSearchPanel } from "./team-search-panel";
import { TeamTaskCard } from "./team-task-card";
import { TeamVoiceMessage } from "./team-voice-message";
import { TeamVoiceRecorder } from "./team-voice-recorder";
import { pinTeamMessageAction, unpinTeamMessageAction } from "../../app/actions/team-messages";
import type { TeamPresenceStatus } from "./team-presence-provider";
import styles from "./team-messages.module.css";

/** Beyond this distance from the bottom, the floating controls become worth showing. */
const SCROLL_AWAY_FROM_LATEST_PX = 320;
/** Within this distance from the top, it is time to fetch the next page of history. */
const LOAD_OLDER_TRIGGER_PX = 200;

/**
 * Geometry for the loading skeleton's placeholder bubbles: an alternating,
 * believable shape (not a uniform column), sized like one or two lines of a
 * real message rather than a full-width bar.
 */
const SKELETON_MESSAGE_SHAPES = [
  { mine: false, width: "58%", height: 34 },
  { mine: false, width: "38%", height: 34 },
  { mine: true, width: "44%", height: 34 },
  { mine: false, width: "66%", height: 50 },
  { mine: true, width: "30%", height: 34 },
] as const;

export type TeamReplyDraft = {
  sourceMessageId: string;
  authorName: string;
  quoteText: string;
};

/*
 * Loaded when a thread is actually opened, not when the shell mounts.
 *
 * The Team drawer is mounted on every internal page so the badge and the
 * transient peek keep working with it shut, and the editor is by far the
 * largest thing in this tree — around 100 kB of the client bundle. Splitting it
 * here keeps that off the first load of every page in the application, and the
 * only moment it is needed is the moment a conversation is open.
 *
 * ssr: false because the editor owns a contenteditable and has no server
 * rendering to contribute.
 */
const TeamRichComposer = dynamic(
  () => import("./team-rich-composer").then((module) => module.TeamRichComposer),
  {
    ssr: false,
    loading: () => <div className={styles.composerLoading} aria-hidden="true" />,
  },
);

/**
 * One conversation: its transcript, the task cards raised inside it, and the
 * composer.
 *
 * Task cards render inline. One raised from a specific message sits
 * immediately after it, so the task and its cause stay adjacent. One raised
 * from the composer has no source message, so it renders at its own
 * chronological `task_activity`/`created` position instead — never a
 * separate sticky block, so the timeline stays one ordered record of what
 * happened and when.
 */
export function TeamConversationPane({
  detail,
  actorProfileId,
  canManageTasks,
  roster,
  loading,
  error,
  onRetry,
  onRetryMessage,
  onDraftChange,
  onBack,
  onCloseDrawer,
  onSend,
  onCreateTaskFromComposer,
  onCreateTaskFromMessage,
  onTaskStatusChange,
  busyTaskId,
  highlightMessageId,
  onHighlightConsumed,
  presenceStatus,
  onLoadOlder,
  loadingOlder,
  hasMoreOlder,
  searchOpen,
  onOpenSearch,
  onCloseSearch,
  onJumpToSearchResult,
  onReact,
  forwardDestinations,
  onForward,
  onDeleteForMe,
  onDeleteForEveryone,
  onJumpToMessage,
  onRenameConversation,
  onSetSlowMode,
  onSetTaskCreationPolicy,
  onGrantAdmin,
  onRevokeAdmin,
  onAddMember,
  onRemoveMember,
  onConversationChanged = () => undefined,
}: {
  detail: TeamConversationDetailView | null;
  actorProfileId: string;
  /** Org-wide team_tasks.manage — status/detail edits only, unrelated to task CREATE. */
  canManageTasks: boolean;
  /** Every active internal teammate, for the Conversation Controls "add member" picker. */
  roster: TeamMemberView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Re-sends one bubble that failed, reusing its original idempotency key. */
  onRetryMessage: (message: TeamMessageView) => void;
  /** Every keystroke, so the drawer can keep this tab marked as composing. */
  onDraftChange: (draft: string) => void;
  onBack: () => void;
  onCloseDrawer: () => void;
  onSend: (body: string, reply: TeamReplyDraft | null) => void;
  onCreateTaskFromComposer: () => void;
  onCreateTaskFromMessage: (message: TeamMessageView) => void;
  onTaskStatusChange: (taskId: string, status: TeamTaskStatus) => void;
  busyTaskId: string | null;
  highlightMessageId: string | null;
  onHighlightConsumed: () => void;
  presenceStatus: TeamPresenceStatus;
  /** Fetches the next older keyset page. A no-op guard while already loading or exhausted. */
  onLoadOlder: () => void;
  loadingOlder: boolean;
  hasMoreOlder: boolean;
  searchOpen: boolean;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onJumpToSearchResult: (result: TeamSearchResultView) => void;
  onReact: (message: TeamMessageView, code: TeamReactionCode) => void;
  forwardDestinations: TeamConversationView[];
  onForward: (message: TeamMessageView, destinationConversationId: string) => Promise<string | null>;
  onDeleteForMe: (message: TeamMessageView) => Promise<string | null>;
  onDeleteForEveryone: (message: TeamMessageView) => Promise<string | null>;
  onJumpToMessage: (messageId: string) => void;
  onRenameConversation: (title: string) => Promise<string | null>;
  onSetSlowMode: (seconds: number | null, scope: TeamSlowModeScope) => Promise<string | null>;
  onSetTaskCreationPolicy: (policy: TeamTaskCreationPolicy) => Promise<string | null>;
  onGrantAdmin: (
    targetProfileId: string,
    capabilities: Partial<Record<TeamConversationCapability, boolean>>,
  ) => Promise<string | null>;
  onRevokeAdmin: (targetProfileId: string) => Promise<string | null>;
  onAddMember: (profileId: string) => Promise<string | null>;
  onRemoveMember: (profileId: string) => Promise<string | null>;
  onConversationChanged?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const previousMessagesRef = useRef<{
    firstId: string | null;
    lastId: string | null;
    conversationId: string | null;
  }>({ firstId: null, lastId: null, conversationId: null });
  const previousScrollHeightRef = useRef<number | null>(null);

  /* Away from the latest message, and — separately — the mobile "tap to reveal reactions" selection. */
  const [scrolledAway, setScrolledAway] = useState(false);
  const [selectedReactionMessageId, setSelectedReactionMessageId] = useState<string | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [moreMessage, setMoreMessage] = useState<TeamMessageView | null>(null);
  const [replyDraft, setReplyDraft] = useState<TeamReplyDraft | null>(null);
  const selectedQuoteRef = useRef<{ messageId: string; text: string } | null>(null);

  /*
   * Bumped on every completed send. The composer clears by remounting on this
   * key, which also retires the undo history of a message that has already
   * left — undo must never reach back into something the recipient can see.
   */
  const [sendNonce, setSendNonce] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);

  const conversationId = detail?.conversationId ?? null;

  /*
   * A live countdown driven by the server's own watermark
   * (`detail.myNextAllowedSendAt`), not a locally-guessed timer: every
   * `app_get_team_conversation` refresh (the live-sync tick already recomputes
   * it) re-anchors this to the actual cooldown, so a second tab or a Slow Mode
   * change elsewhere in the conversation is reflected here too, not just an
   * optimistic local guess.
   */
  const [slowModeSecondsLeft, setSlowModeSecondsLeft] = useState(0);
  useEffect(() => {
    const nextAllowedAt = detail?.myNextAllowedSendAt;
    let interval: number | undefined;
    /*
     * The tick (including its first, immediate read) runs from a callback
     * rather than synchronously in the effect body — the lint-clean shape
     * for a value that has to be read again on a timer anyway.
     */
    const kickoff = window.setTimeout(() => {
      if (!nextAllowedAt) {
        setSlowModeSecondsLeft(0);
        return;
      }
      const target = new Date(nextAllowedAt).getTime();
      const tick = () => setSlowModeSecondsLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
      tick();
      interval = window.setInterval(tick, 1000);
    }, 0);
    return () => {
      window.clearTimeout(kickoff);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [detail?.myNextAllowedSendAt]);

  /*
   * A new thread starts with an empty composer, never the previous draft.
   * Adjusted during render rather than in an effect, so the stale text is never
   * committed to the DOM for a frame after the thread has already changed.
   */
  const [draftConversationId, setDraftConversationId] =
    useState(conversationId);
  if (conversationId !== draftConversationId) {
    setDraftConversationId(conversationId);
    setDraft("");
    setScrolledAway(false);
    setSelectedReactionMessageId(null);
    setReactionPickerMessageId(null);
    setMoreMessage(null);
    setControlsOpen(false);
    setReplyDraft(null);
    setControlsOpen(false);
  }

  /*
   * Three cases, distinguished purely from how the message array changed
   * between renders — no coordination with whoever fetched it:
   *
   *   - the thread itself changed: jump to the bottom without animation,
   *     since arriving mid-scroll in a conversation you just opened is
   *     disorienting;
   *   - the array grew at the FRONT (older history was prepended, or a
   *     search jump merged in messages before the current range) and the
   *     tail is unchanged: hold the visually anchored content in place by
   *     adding exactly the height that was inserted above it to scrollTop —
   *     the standard fix for the classic "upward infinite scroll" jump;
   *   - a new message arrived at the tail: stick to the bottom, smoothly.
   *
   * A pure jump-to-message (the target sits somewhere in the middle, both
   * ends unchanged) matches none of the three, so this effect does nothing
   * and the dedicated highlight effect below performs the scrollIntoView.
   */
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !detail) return;

    const messages = detail.messages;
    const firstId = messages[0]?.id ?? null;
    const lastId = messages[messages.length - 1]?.id ?? null;
    const previous = previousMessagesRef.current;
    const threadChanged = previous.conversationId !== detail.conversationId;
    const prepended =
      !threadChanged &&
      previous.firstId !== null &&
      firstId !== previous.firstId &&
      lastId === previous.lastId;

    if (threadChanged) {
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    } else if (prepended) {
      const previousHeight = previousScrollHeightRef.current ?? node.scrollHeight;
      node.scrollTop = node.scrollTop + (node.scrollHeight - previousHeight);
    } else if (lastId !== previous.lastId) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }

    previousMessagesRef.current = { firstId, lastId, conversationId: detail.conversationId };
    previousScrollHeightRef.current = node.scrollHeight;
  }, [detail]);

  /* Source-message / search-result navigation: scroll it into view, then flash it once. */
  useEffect(() => {
    if (!highlightMessageId) return;
    const node = messageRefs.current.get(highlightMessageId);
    if (!node) {
      onHighlightConsumed();
      return;
    }

    node.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(onHighlightConsumed, 1600);
    return () => window.clearTimeout(timer);
  }, [highlightMessageId, onHighlightConsumed]);

  /*
   * Scroll signals: how far from the latest message drives the floating
   * "Search conversation" / "Return to latest" controls, and how close to the
   * top of the loaded window triggers the next keyset page.
   */
  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setScrolledAway(distanceFromBottom > SCROLL_AWAY_FROM_LATEST_PX);

    if (node.scrollTop < LOAD_OLDER_TRIGGER_PX && hasMoreOlder && !loadingOlder) {
      onLoadOlder();
    }
  }, [hasMoreOlder, loadingOlder, onLoadOlder]);

  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setScrolledAway(false);
  }, []);

  /*
   * Ctrl/Cmd+F is intercepted only while a Team conversation is open, so
   * browser page search is replaced by Team conversation search here and
   * nowhere else in the application. Escape closes it, handled inside
   * TeamSearchPanel itself so focus stays with the input.
   */
  useEffect(() => {
    if (!detail) return;

    function onKeyDown(event: KeyboardEvent) {
      const isFindShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      if (!isFindShortcut) return;
      event.preventDefault();
      onOpenSearch();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detail, onOpenSearch]);

  const trimmed = draft.trim();
  const overLimit = draft.length > teamMessageMaxLength;
  const canSend = trimmed.length > 0 && !overLimit && slowModeSecondsLeft === 0;
  /** Conversation task_creation_policy is authoritative — never canManageTasks (org-wide, unrelated). */
  const canCreateTask = detail?.capabilities.canCreateTask ?? false;

  const pinMessage = useCallback(async (message: TeamMessageView) => {
    if (!detail) return "No conversation is open.";
    const result = await pinTeamMessageAction({ conversationId: detail.conversationId, messageId: message.id });
    if (!result.ok) return result.error;
    onConversationChanged();
    return null;
  }, [detail, onConversationChanged]);

  const unpinMessage = useCallback(async (pin: NonNullable<TeamConversationDetailView["currentPins"]>[number]) => {
    if (!detail) return "No conversation is open.";
    const result = await unpinTeamMessageAction({ conversationId: detail.conversationId, pinId: pin.id });
    if (!result.ok) return result.error;
    onConversationChanged();
    return null;
  }, [detail, onConversationChanged]);

  const handleDraftChange = useCallback(
    (markdown: string) => {
      setDraft(markdown);
      onDraftChange(markdown);
    },
    [onDraftChange],
  );

  useEffect(() => {
    if (!detail) return;
    function rememberSelection() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      if (!anchor || !focus) return;
      const anchorElement = anchor.nodeType === Node.ELEMENT_NODE
        ? anchor as Element
        : anchor.parentElement;
      const focusElement = focus.nodeType === Node.ELEMENT_NODE
        ? focus as Element
        : focus.parentElement;
      const body = anchorElement?.closest<HTMLElement>("[data-team-message-body]");
      if (!body || !body.contains(focusElement)) return;
      const text = normalizeReplyQuote(selection.toString());
      const messageId = body.dataset.teamMessageBody;
      if (text && messageId) {
        selectedQuoteRef.current = { messageId, text };
        setSelectedReactionMessageId((current) => current === messageId ? current : messageId);
      }
    }
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, [detail]);

  const beginReply = useCallback((message: TeamMessageView) => {
    const cached = selectedQuoteRef.current;
    const quoteText = cached?.messageId === message.id
      ? cached.text
      : normalizeReplyQuote(stripTeamFormatting(message.body));
    setReactionPickerMessageId(null);
    setMoreMessage(null);
    setSelectedReactionMessageId(null);
    setReplyDraft({
      sourceMessageId: message.id,
      authorName: message.authorName,
      quoteText,
    });
  }, []);

  /*
   * The pinned (tap-to-reveal) toolbar is a deliberate, explicit selection —
   * separate from CSS `:hover`/`:focus-within`, which keeps working
   * regardless of this state. It clears itself here on any pointerdown
   * outside the currently-pinned message's own row, so a click on another
   * message, the composer, the header, or Settings closes it the same way a
   * second tap on the same message already does. Reply/react/More each clear
   * it explicitly at their own completion point, since those interactions
   * can start and end without the pointer ever leaving the pinned message
   * (e.g. the reaction picker or the portalled More dialog).
   */
  useEffect(() => {
    if (!selectedReactionMessageId) return;
    function onPointerDownOutside(event: PointerEvent) {
      const pinnedNode = messageRefs.current.get(selectedReactionMessageId!);
      if (pinnedNode?.contains(event.target as Node)) return;
      setSelectedReactionMessageId(null);
    }
    document.addEventListener("pointerdown", onPointerDownOutside);
    return () => document.removeEventListener("pointerdown", onPointerDownOutside);
  }, [selectedReactionMessageId]);

  /*
   * The composer empties on this frame, before the round trip starts. The
   * bubble the drawer inserts optimistically is what the sender sees next, so
   * there is no window in which the text has left the box and not yet appeared
   * in the thread.
   */
  const send = useCallback(
    (body: string) => {
      onSend(body, replyDraft);
      setDraft("");
      onDraftChange("");
      setReplyDraft(null);
      setSendNonce((value) => value + 1);
    },
    [onDraftChange, onSend, replyDraft],
  );

  if (!detail && loading) {
    return (
      <section
        className={styles.conversationPane}
        aria-label="Conversation"
        role="status"
        aria-busy="true"
      >
        <span className={styles.srOnly}>Loading conversation</span>
        <div className={styles.conversationThread} aria-hidden="true">
          <div>
            <header className={styles.paneHeader}>
              <span className={`${styles.iconButton} ${styles.backButton}`} />
              <span className={styles.skeletonAvatar} />
              <div className={styles.paneHeaderText}>
                <span className={styles.skeletonBar} style={{ width: "42%", height: 12 }} />
                <span
                  className={styles.skeletonBar}
                  style={{ width: "26%", height: 9, marginTop: 5 }}
                />
              </div>
            </header>
          </div>

          <div className={styles.messageScroll}>
            {SKELETON_MESSAGE_SHAPES.map((shape, index) => (
              <div
                key={index}
                className={[styles.messageGroup, shape.mine ? styles.messageGroupMine : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                {shape.mine ? null : <span className={styles.skeletonAvatar} />}
                <div className={styles.messageGroupBody}>
                  <span
                    className={[styles.bubble, styles.skeletonBubble].join(" ")}
                    style={{ width: shape.width, height: shape.height }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className={styles.composer}>
            <div className={styles.composerBox}>
              <span className={styles.skeletonComposerEditor} />
              <div className={styles.composerRow}>
                <span className={styles.skeletonBar} style={{ width: 150, height: 9 }} />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className={styles.conversationPane}>
        <div className={styles.paneHeader} />
        <div
          className={`${styles.stateBlock} ${error ? styles.stateError : ""}`}
        >
          <span className={styles.stateIcon}>
            {error ? (
              <AlertCircle aria-hidden="true" />
            ) : (
              <MessageSquare aria-hidden="true" />
            )}
          </span>
          <strong>
            {error
              ? "This conversation could not be opened"
              : "No conversation open"}
          </strong>
          <p>
            {error ??
              "Pick a colleague on the left to see your thread with them."}
          </p>
          {error ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
        <div />
      </section>
    );
  }

  const other = detail.otherMember;
  const isGroup = detail.kind === "group";
  const typingLabel = teamTypingLabel(detail.typingMembers);
  const taskCount = detail.tasks.length;

  return (
    <section
      className={[
        styles.conversationPane,
        controlsOpen ? styles.conversationPaneSettingsOpen : "",
      ].filter(Boolean).join(" ")}
      aria-label="Conversation"
    >
      <div className={styles.conversationThread} data-team-region="message-thread">
      {/*
        One grid cell for the header plus everything that can conditionally
        grow above the transcript (search, the inline error banner). Without
        this wrapper, each conditional sibling would consume its own implicit
        grid row in `.conversationPane`'s fixed 3-track layout and displace
        `.messageScroll` out of its `minmax(0, 1fr)` row, which is what
        produced overlapping, unclickable content underneath it.
      */}
      <div>
      <header className={styles.paneHeader}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.backButton}`}
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft aria-hidden="true" />
        </button>

        {isGroup ? (
          <TeamConversationAvatar imageUrl={detail.imageUrl} small />
        ) : other ? (
          <TeamAvatar
            name={other.name}
            initials={other.initials}
            avatarUrl={other.avatarUrl}
            small
          />
        ) : null}

        <div className={styles.paneHeaderText}>
          <strong>{detail.name}</strong>
          {/*
            One subtitle slot, and typing outranks everything in it: while a
            colleague is composing, that is the only status worth the line.
          */}
          {typingLabel ? (
            <span className={styles.headerTyping}>
              <TypingDots />
              {typingLabel}
            </span>
          ) : isGroup ? (
            <span className={styles.headerPresence}>
              {detail.members.length} members
              {taskCount > 0 ? (
                <span className={styles.headerTaskCount}>
                  · {taskCount} {taskCount === 1 ? "task" : "tasks"}
                </span>
              ) : null}
              {detail.slowModeSeconds ? (
                <span className={styles.headerTaskCount}>
                  · Slow Mode {formatSlowModeSeconds(detail.slowModeSeconds)}
                </span>
              ) : null}
            </span>
          ) : presenceStatus === "unknown" ? (
            <span>Internal Wolf Forge conversation</span>
          ) : (
            <span className={styles.headerPresence}>
              <span
                className={[
                  styles.headerPresenceDot,
                  presenceStatus === "online"
                    ? styles.headerPresenceDotOnline
                    : styles.headerPresenceDotOffline,
                ].join(" ")}
                aria-hidden="true"
              />
              {presenceStatus === "online" ? "Online" : "Offline"}
              {taskCount > 0 ? (
                <span className={styles.headerTaskCount}>
                  · {taskCount} {taskCount === 1 ? "task" : "tasks"}
                </span>
              ) : null}
              {detail.slowModeSeconds ? (
                <span className={styles.headerTaskCount}>
                  · Slow Mode {formatSlowModeSeconds(detail.slowModeSeconds)}
                </span>
              ) : null}
            </span>
          )}
        </div>

        <div className={styles.paneHeaderActions}>
          {loading ? (
            <Loader2 aria-label="Refreshing" className={styles.spin} />
          ) : null}
          <button
            ref={settingsTriggerRef}
            type="button"
            className={[
              styles.iconButton,
              controlsOpen ? styles.iconButtonActive : "",
            ].filter(Boolean).join(" ")}
            onClick={() => setControlsOpen(true)}
            aria-label="Conversation settings"
            aria-expanded={controlsOpen}
            title="Conversation settings"
          >
            <Settings aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onCloseDrawer}
            aria-label="Close conversation"
            title="Close conversation"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </header>

      {error ? (
        <div className={styles.inlineError} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
          <button
            type="button"
            className={styles.inlineErrorRetry}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
      </div>

      <div className={styles.threadContextLayer} data-team-region="history-toolbar">
        {searchOpen ? (
          <TeamSearchPanel
            open={searchOpen}
            conversationId={detail.conversationId}
            onClose={onCloseSearch}
            onJumpToResult={onJumpToSearchResult}
          />
        ) : (
          <div className={styles.historyToolbar} aria-label="Conversation history controls">
            <TeamPinsPanel
              current={detail.currentPins ?? []}
              previous={detail.previousPins ?? []}
              canManage={detail.capabilities.canManagePins === true}
              onJump={onJumpToMessage}
              onUnpin={unpinMessage}
            />
            <button
              type="button"
              className={styles.historyToolbarButton}
              onClick={onOpenSearch}
            >
              <Search aria-hidden="true" />
              Search
            </button>
            {scrolledAway ? (
              <button
                type="button"
                className={`${styles.historyToolbarButton} ${styles.historyToolbarLatest}`}
                onClick={scrollToLatest}
                aria-label="Return to latest"
              >
                <ArrowDown aria-hidden="true" />
                Latest
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div
        className={styles.messageScroll}
        ref={scrollRef}
        onScroll={handleScroll}
        key={detail.conversationId}
        data-team-region="message-scroll"
      >
        {loadingOlder ? (
          <div className={styles.loadOlderRow} aria-live="polite">
            <Loader2 className={styles.spin} size={14} aria-hidden="true" />
            <span>Loading earlier messages…</span>
          </div>
        ) : null}

        {detail.messages.length === 0 ? (
          <div className={styles.stateBlock}>
            <span className={styles.stateIcon}>
              <MessageSquare aria-hidden="true" />
            </span>
            <strong>No messages yet</strong>
            <p>
              {isGroup
                ? `Say something to start ${detail.name}.`
                : `Say something to ${other?.name ?? "your colleague"} to start this thread.`}
            </p>
          </div>
        ) : null}

        {detail.groups.map((group) => (
          <div key={group.key}>
            {group.startsDay ? (
              <div className={styles.dayDivider}>
                <span className={styles.dayHeading}>
                  {formatTeamDayHeading(group.day)}
                </span>
              </div>
            ) : null}

            {/*
              A completion, reopening, creation or governance change is not a
              message anybody typed, so it does not take a bubble, an avatar
              or a side. It sits in the centre of the thread as the record of
              a state change — including a composer-created task, which
              renders its real, interactive card here instead of collecting
              in a separate sticky block at the foot of the thread.
            */}
            {group.messages[0]!.messageType === "governance_activity" ? (
              <div className={styles.activityRow}>
                <span className={styles.activityChip}>
                  <Settings aria-hidden="true" />
                  {group.messages[0]!.body}
                  <time
                    className={styles.activityTime}
                    dateTime={group.messages[0]!.createdAt}
                  >
                    {formatTeamMessageTime(group.messages[0]!.createdAt)}
                  </time>
                </span>
              </div>
            ) : group.messages[0]!.messageType === "task_activity" &&
              group.messages[0]!.taskAction === "created" ? (
              <div className={styles.activityRow} style={{ display: "grid", justifyItems: "start", gap: 6 }}>
                <span className={styles.activityChip}>
                  <Plus aria-hidden="true" />
                  {teamActivityLabel(group.messages[0]!)}
                  <time
                    className={styles.activityTime}
                    dateTime={group.messages[0]!.createdAt}
                  >
                    {formatTeamMessageTime(group.messages[0]!.createdAt)}
                  </time>
                </span>
                {group.messages[0]!.taskId && detail.tasksById.get(group.messages[0]!.taskId!) ? (
                  <TeamTaskCard
                    task={detail.tasksById.get(group.messages[0]!.taskId!)!}
                    actorProfileId={actorProfileId}
                    canManageTasks={canManageTasks}
                    busy={busyTaskId === group.messages[0]!.taskId}
                    onStatusChange={(status) =>
                      onTaskStatusChange(group.messages[0]!.taskId!, status)
                    }
                  />
                ) : null}
              </div>
            ) : group.messages[0]!.messageType === "task_activity" ? (
              <div className={styles.activityRow}>
                <span className={styles.activityChip}>
                  <CheckCircle2 aria-hidden="true" />
                  {teamActivityLabel(group.messages[0]!)}
                  <time
                    className={styles.activityTime}
                    dateTime={group.messages[0]!.createdAt}
                  >
                    {formatTeamMessageTime(group.messages[0]!.createdAt)}
                  </time>
                </span>
              </div>
            ) : (
            <div
              className={[
                styles.messageGroup,
                group.isMine ? styles.messageGroupMine : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {group.isMine ? null : (
                <TeamAvatar
                  name={group.authorName}
                  initials={group.authorInitials}
                  avatarUrl={group.authorAvatarUrl}
                  small
                />
              )}

              <div className={styles.messageGroupBody}>
                {group.isMine ? null : (
                  <span className={styles.messageAuthor}>
                    {group.authorName}
                  </span>
                )}

                {group.messages.map((message) => {
                  const anchoredTasks =
                    detail.tasksBySourceMessage.get(message.id) ?? [];

                  return (
                    <div
                      key={message.id}
                      ref={(node) => {
                        if (node) messageRefs.current.set(message.id, node);
                        else messageRefs.current.delete(message.id);
                      }}
                      className={
                        highlightMessageId === message.id
                          ? styles.messageHighlighted
                          : undefined
                      }
                      style={{
                        display: "grid",
                        gap: 6,
                        justifyItems: group.isMine ? "end" : "start",
                      }}
                    >
                      <div className={styles.bubbleRow}>
                        <div
                          className={[
                            styles.bubble,
                            message.isMine ? styles.bubbleMine : "",
                            message.deletedForEveryone ? styles.bubbleDeleted : "",
                            message.pending ? styles.bubblePending : "",
                            message.failed ? styles.bubbleFailed : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={(event) => {
                            if ((event.target as HTMLElement).closest("a")) return;
                            if (message.pending || message.failed || message.deletedForEveryone) return;
                            if (!window.getSelection()?.isCollapsed) {
                              setSelectedReactionMessageId(message.id);
                              return;
                            }
                            setSelectedReactionMessageId((current) =>
                              current === message.id ? null : message.id,
                            );
                          }}
                          data-team-message-body={message.id}
                        >
                          {(message.forwardedFromMessageId || message.forwardedFromTicketMessageId)
                            && !message.deletedForEveryone ? (
                            <span className={styles.forwardedLabel}>
                              Forwarded{message.forwardedFromAuthorName
                                ? ` from ${message.forwardedFromAuthorName}`
                                : ""}
                            </span>
                          ) : null}
                          {message.replyToMessageId && !message.deletedForEveryone ? (
                            <button
                              type="button"
                              className={styles.replyQuote}
                              disabled={message.replySourceDeleted}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!message.replySourceDeleted) onJumpToMessage(message.replyToMessageId!);
                              }}
                            >
                              <strong>{message.replySourceDeleted
                                ? "Message deleted"
                                : message.replySourceAuthorName ?? "A colleague"}</strong>
                              {message.replySourceDeleted ? null : <span>{message.replyQuoteText}</span>}
                            </button>
                          ) : null}
                          {message.deletedForEveryone ? (
                            <span className={styles.deletedMessage}>Message deleted</span>
                          ) : message.messageType === "voice" && message.voice ? (
                            <TeamVoiceMessage
                              conversationId={detail.conversationId}
                              messageId={message.id}
                              durationMs={message.voice.durationMs}
                              expired={Boolean(message.voice.expiredAt || !message.voice.storagePath)}
                            />
                          ) : (
                            <TeamFormattedMessage body={message.body} />
                          )}
                        </div>

                        {message.failed ? (
                          <button
                            type="button"
                            className={styles.bubbleRetry}
                            onClick={() => onRetryMessage(message)}
                          >
                            <RotateCcw aria-hidden="true" />
                            Not sent · Retry
                          </button>
                        ) : message.pending ? (
                          <span className={styles.bubblePendingStatus} aria-live="polite">
                            <Loader2 className={styles.spin} aria-hidden="true" />
                            Sending…
                          </span>
                        ) : (
                          <time
                            className={styles.bubbleTime}
                            dateTime={message.createdAt}
                          >
                            {formatTeamMessageTime(message.createdAt)}
                          </time>
                        )}

                        {message.messageType === "text" && !message.pending && !message.failed && !message.deletedForEveryone ? (
                          <TeamReactionRail
                            reactions={message.reactions}
                            onReact={(code) => onReact(message, code)}
                            mobileActive={selectedReactionMessageId === message.id}
                            onInteract={() => setSelectedReactionMessageId(message.id)}
                            pickerOpen={reactionPickerMessageId === message.id}
                            onTogglePicker={() => {
                              setMoreMessage(null);
                              setReactionPickerMessageId((current) =>
                                current === message.id ? null : message.id,
                              );
                            }}
                            onClosePicker={() => {
                              setReactionPickerMessageId((current) =>
                                current === message.id ? null : current
                              );
                              setSelectedReactionMessageId((current) =>
                                current === message.id ? null : current
                              );
                            }}
                            onReply={() => beginReply(message)}
                            onMore={() => {
                              setReactionPickerMessageId(null);
                              setMoreMessage(message);
                            }}
                          />
                        ) : null}
                      </div>

                      {message.messageType === "text" && !message.pending && !message.failed && message.reactions.length > 0 ? (
                        <TeamReactionChips
                          reactions={message.reactions}
                          onToggle={(code) => onReact(message, code)}
                        />
                      ) : null}

                      {anchoredTasks.map((task) => (
                        <TeamTaskCard
                          key={task.id}
                          task={task}
                          actorProfileId={actorProfileId}
                          canManageTasks={canManageTasks}
                          busy={busyTaskId === task.id}
                          onStatusChange={(status) =>
                            onTaskStatusChange(task.id, status)
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>
        ))}

        {/*
          The live typing row sits where the next message will land, so the
          transcript does not jump when it arrives. Announced politely rather
          than assertively: it is ambient, not an alert.
        */}
        {typingLabel ? (
          <div className={styles.typingRow} aria-live="polite">
            {detail.typingMembers.slice(0, 3).map((member) => (
              <TeamAvatar
                key={member.profileId}
                name={member.name}
                initials={member.initials}
                avatarUrl={member.avatarUrl}
                small
              />
            ))}
            <span className={styles.typingBubble}>
              <TypingDots />
              <span className={styles.typingText}>{typingLabel}</span>
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.composer}>
        <div className={styles.composerBox}>
          {replyDraft ? (
            <div className={styles.composerReplyStrip}>
              <span>
                <strong>Replying to {replyDraft.authorName}</strong>
                <span>“{replyDraft.quoteText}”</span>
              </span>
              <button type="button" onClick={() => setReplyDraft(null)} aria-label="Cancel reply">
                <X aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <TeamRichComposer
            mentionMembers={detail.kind === "group" ? detail.members : undefined}
            placeholder={`Message ${detail.name}…`}
            ariaLabel={`Message ${detail.name}`}
            onChange={handleDraftChange}
            onSubmit={send}
            canSubmit={canSend}
            resetKey={detail.conversationId}
            clearSignal={sendNonce}
          />

          <div className={styles.composerRow}>
            <span className={styles.composerHint}>
              {slowModeSecondsLeft > 0
                ? `Slow mode: wait ${slowModeSecondsLeft}s`
                : "Enter to send · Shift+Enter for a new line"}
            </span>

            {draft.length > teamMessageMaxLength - 400 ? (
              <span
                className={[
                  styles.composerCount,
                  overLimit ? styles.composerCountWarn : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {draft.length} / {teamMessageMaxLength}
              </span>
            ) : null}

            {canCreateTask ? (
              <button
                type="button"
                className={styles.ghostButton}
                onClick={onCreateTaskFromComposer}
                title="Create a task in this conversation"
              >
                <Plus aria-hidden="true" />
                Task
              </button>
            ) : null}

            {detail.capabilities.canSendVoice ? (
              <TeamVoiceRecorder
                key={detail.conversationId}
                conversationId={detail.conversationId}
                disabled={slowModeSecondsLeft > 0}
                onSent={onConversationChanged}
              />
            ) : null}

            <button
              type="button"
              className={styles.sendButton}
              disabled={!canSend}
              onClick={() => send(trimmed)}
              aria-label="Send message"
            >
              <Send aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <TeamMessageActions
        message={moreMessage}
        destinations={forwardDestinations}
        canCreateTask={canCreateTask}
        onClose={() => {
          setMoreMessage(null);
          if (moreMessage) {
            setSelectedReactionMessageId((current) =>
              current === moreMessage.id ? null : current
            );
          }
        }}
        onCreateTask={onCreateTaskFromMessage}
        onForward={onForward}
        onDeleteForMe={onDeleteForMe}
        onDeleteForEveryone={onDeleteForEveryone}
        canManagePins={detail.capabilities.canManagePins}
        currentPin={moreMessage
          ? detail.currentPins?.find((pin) => pin.messageId === moreMessage.id) ?? null
          : null}
        onPin={pinMessage}
        onUnpin={unpinMessage}
      />
      </div>

      <TeamConversationControls
        open={controlsOpen}
        detail={detail}
        roster={roster}
        onClose={() => {
          setControlsOpen(false);
          window.setTimeout(() => settingsTriggerRef.current?.focus(), 0);
        }}
        onRename={onRenameConversation}
        onSetSlowMode={onSetSlowMode}
        onSetTaskCreationPolicy={onSetTaskCreationPolicy}
        onGrantAdmin={onGrantAdmin}
        onRevokeAdmin={onRevokeAdmin}
        onAddMember={onAddMember}
        onRemoveMember={onRemoveMember}
      />
    </section>
  );
}

function normalizeReplyQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, teamReplyQuoteMaxLength);
}

/**
 * Three restrained dots.
 *
 * The animation is a low-amplitude opacity lift on the house curve rather than
 * a bounce — this is a status, not a celebration — and it stands still for
 * anyone who has asked for reduced motion.
 */
function TypingDots() {
  return (
    <span className={styles.typingDots} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
