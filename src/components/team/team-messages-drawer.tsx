"use client";
import { randomUuid } from "../../lib/random-uuid";

import {
  AlertCircle,
  ArrowLeft,
  Inbox,
  Info,
  MessageSquare,
  PenLine,
  Ticket as TicketIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyOptimisticTeamReactionToggle,
  formatTeamRelativeTime,
  groupTeamMessages,
  mergeTeamMessageViews,
  stillPendingTeamMessages,
  teamInitials,
  toTeamConversationDetailView,
  toTeamConversationViews,
  toTeamMemberViews,
  toTeamMessageViews,
  toTeamReactionViews,
  totalTeamUnread,
  type TeamConversationDetailView,
  type TeamConversationView,
  type TeamMemberView,
  type TeamMessageView,
  type TeamReactionView,
  type TeamSearchResultView,
} from "../../domain/team/projections";
import type { TicketCapabilities, TicketDetail } from "../../domain/tickets/schema";
import type { ServiceAssigneeOption } from "../../repositories/service-repository";
import {
  getTicketInboxConversationAction,
  listTicketAssigneesAction,
} from "../../app/actions/tickets";
import { TicketAdminConversation } from "../tickets/ticket-admin-conversation";
import { TicketInspector } from "../tickets/ticket-inspector";
import { TeamTicketsPane } from "./team-tickets-pane";
import { useTicketInboxList } from "./use-ticket-inbox-list";
import type {
  TeamConversationCapability,
  TeamConversationDetailRow,
  TeamConversationRow,
  TeamMemberRow,
  TeamMessageRow,
  TeamReactionCode,
  TeamSlowModeScope,
  TeamTaskCreationPolicy,
  TeamTaskStatus,
} from "../../domain/team/schema";
import {
  addTeamConversationMemberAction,
  createTeamGroupAction,
  createTeamTaskAction,
  deleteTeamMessageForEveryoneAction,
  forwardTeamMessageAction,
  getTeamMessageWindowAction,
  grantTeamConversationAdminAction,
  listTeamMessagesBeforeAction,
  markTeamConversationReadAction,
  hideTeamMessageForMeAction,
  removeTeamConversationMemberAction,
  renameTeamConversationAction,
  revokeTeamConversationAdminAction,
  sendTeamMessageAction,
  sendTeamReplyAction,
  setTeamConversationSlowModeAction,
  setTeamTaskCreationPolicyAction,
  startTeamConversationAction,
  toggleTeamMessageReactionAction,
  updateTeamTaskStatusAction,
} from "../../app/actions/team-messages";
import { TeamAvatar } from "./team-avatar";
import { TeamConversationAvatar } from "./team-conversation-avatar";
import { TeamConversationCreator } from "./team-conversation-creator";
import { TeamConversationPane, type TeamReplyDraft } from "./team-conversation-view";
import { TeamTaskComposer, type TeamTaskDraft } from "./team-task-composer";
import {
  useTeamPresence,
  type TeamPresenceStatus,
} from "./team-presence-provider";
import { useClientMounted, useExitTransition } from "./use-exit-transition";
import { fetchTeamLive, fetchTeamSync, sendTeamTyping } from "./team-http-client";
import { useTeamSyncController } from "./use-team-sync-controller";
import { teamDetailFingerprint, teamSignalsIndicateChange } from "../../domain/team/live-scheduler";
import styles from "./team-messages.module.css";

type Pane = "messages" | "tickets";

type TeamMessagePeek = {
  conversationId: string;
  conversationName: string;
  senderName: string;
  senderAvatarUrl: string | null;
  preview: string;
  count: number;
  version: number;
};

/**
 * How long a keystroke keeps this tab marked as composing.
 *
 * The database expires a typing row after 3.5 seconds, so refreshing every 2
 * gives one dropped round trip of headroom without turning each keystroke into
 * a request.
 */
const TYPING_HEARTBEAT_MS = 2_000;

/** What the task composer was opened against, or null when it is shut. */
type ComposerSession = {
  /** Distinct per open, so each open mounts a composer with fresh fields. */
  key: string;
  sourceMessage: TeamMessageView | null;
};

/**
 * "Is this request still the one the viewer is waiting for?"
 *
 * Every loader takes one and re-asks it after its await. Switching
 * conversations, or closing the drawer, invalidates whatever was in flight, so
 * a slow answer for the previous thread can never overwrite the current one.
 * Event handlers pass nothing and are always current by definition.
 */
type StaleGuard = () => boolean;

const alwaysCurrent: StaleGuard = () => true;

/**
 * The Messages workspace.
 *
 * Desktop: a right-side drawer, two panes — conversations and the open thread.
 * Mobile: the same component full-screen, one pane at a time, with the back
 * control that only exists at that width.
 *
 * NOT REALTIME, on purpose. The team tables have every privilege revoked from
 * anon, authenticated and service_role and force RLS with no policies, so a
 * Supabase realtime subscription would authorize as the browser role and
 * receive nothing at all. Claiming realtime here would mean handing the browser
 * a Supabase token and weakening the read boundary that makes internal
 * conversation private in the first place.
 *
 * So it synchronizes instead, through ONE scheduler
 * (`useTeamSyncController`) driving TWO lanes. `/api/team-live` answers the
 * questions a viewer experiences as immediate — is someone typing, has a
 * message arrived — in a single database call on a sub-second cadence.
 * `/api/team-sync` carries the conversation list, the roster, the task lists
 * and the offline digest sweep on a slow one. They were split because the fast
 * question used to wait behind the slow work, which cost nothing on loopback
 * and seconds from a serverless function to a hosted project.
 *
 * Both lanes pause while the tab is hidden and both reconcile immediately on
 * focus, on send, and on any task mutation. There is deliberately no second
 * timer anywhere in this tree.
 */
export function TeamMessagesDrawer({
  open,
  onClose,
  actorProfileId,
  actorName,
  canManageTasks,
  canUseTeamMessages,
  ticketCapabilities,
  initialConversationId,
  initialTicketId,
  onUnreadChange,
  onRequestOpen,
  onRootElement,
}: {
  open: boolean;
  onClose: () => void;
  actorProfileId: string;
  actorName: string | null;
  canManageTasks: boolean;
  /** Gates the Messages tab. A ticket-only account still opens the Inbox. */
  canUseTeamMessages: boolean;
  /** Gates the Tickets tab and every read inside it. */
  ticketCapabilities: TicketCapabilities;
  /** From ?team-messages=<id>, so a notification can open a specific thread. */
  initialConversationId: string | null;
  /** From ?inbox=tickets&ticket=<id>, from the Ticket Detail page's "Open in Inbox". */
  initialTicketId: string | null;
  onUnreadChange: (unread: number) => void;
  onRequestOpen: () => void;
  /** The mobile edge lever reads this to drive a live drag reveal. */
  onRootElement?: (el: HTMLDivElement | null) => void;
}) {
  const mounted = useClientMounted();
  const { render, phase } = useExitTransition(open, 200);
  const { statusFor } = useTeamPresence();

  const [pane, setPane] = useState<Pane>(canUseTeamMessages ? "messages" : "tickets");
  const [conversations, setConversations] = useState<TeamConversationRow[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(
    null,
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<
    Record<string, TeamConversationDetailRow>
  >({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<TeamMessageView[]>([]);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    null,
  );

  /*
   * History pagination and search state, kept per conversation id so a
   * scrollback session survives switching threads and back. `olderMessages`
   * holds keyset pages and jump-to-message windows that fall outside the
   * live lane's own latest-300 window; `mergeTeamMessageViews` folds them
   * together with whatever `detailRow` currently carries, de-duplicated.
   */
  const [olderMessages, setOlderMessages] = useState<Record<string, TeamMessageView[]>>({});
  const [hasMoreOlder, setHasMoreOlder] = useState<Record<string, boolean>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);

  /*
   * The optimistic half of a reaction toggle. Cleared unconditionally the
   * moment the request settles (success or failure): on success the very
   * next `refreshNow()` brings the authoritative aggregate from the server,
   * and on failure removing the override simply reverts to whatever the
   * server already has, which is the correct rollback.
   */
  const [reactionOverrides, setReactionOverrides] = useState<
    Record<string, TeamReactionView[]>
  >({});

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchConversationId, setSearchConversationId] = useState<string | null>(null);
  /*
   * A search surface belongs only to the thread it was opened on. Adjusted
   * during render, the same idiom as `draftConversationId` below and
   * `consumedDeepLink` above, rather than an effect that would flag
   * react-hooks/set-state-in-effect for resetting state in response to a
   * changed prop.
   */
  if (searchOpen && activeId !== searchConversationId) {
    setSearchOpen(false);
  }

  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatorBusy, setCreatorBusy] = useState(false);
  const [creatorError, setCreatorError] = useState<string | null>(null);

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  /*
   * The selected Ticket's full conversation, fetched on demand when a Ticket
   * row is chosen in the Tickets pane. This drawer is that conversation's one
   * home: /tickets/[ticketId] is the management surface and renders no
   * transcript (see ticket-workspace.tsx), so nothing else is running a second
   * live poller for the same Ticket in the same tab.
   */
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false);
  const [ticketDetailError, setTicketDetailError] = useState<string | null>(null);
  const [ticketInspectorOpen, setTicketInspectorOpen] = useState(false);

  const [ticketAssignees, setTicketAssignees] = useState<ServiceAssigneeOption[]>([]);

  const [composer, setComposer] = useState<ComposerSession | null>(null);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const [messagePeek, setMessagePeek] = useState<TeamMessagePeek | null>(null);
  const [messagePeekOpen, setMessagePeekOpen] = useState(false);
  const messagePeekTransition = useExitTransition(messagePeekOpen, 200);
  const conversationSnapshotRef = useRef<
    Map<string, { messageId: string | null; unreadCount: number }>
  >(new Map());
  const conversationSnapshotReadyRef = useRef(false);

  /*
   * This tab's own delta cursor: the `server_time` of its previous live answer.
   * Sending it back is what lets the fast lane reply "nothing moved" instead of
   * re-describing every conversation on every tick.
   */
  const liveCursorRef = useRef<string | null>(null);

  /*
   * The V2.5 scheduler's "did anything meaningful change" signal for the
   * currently open transcript, compared against the previous live answer
   * for the SAME conversation. Reset on conversation switch so a fresh
   * thread's first answer is never diffed against a different thread's tail.
   */
  const liveDetailFingerprintRef = useRef<string>("");
  const liveDetailFingerprintConversationRef = useRef<string | null>(null);

  /*
   * Which deep link has already been honoured. Adjusting state during render is
   * React's documented way to respond to a changing input, and it avoids an
   * effect that would open the thread one paint after the drawer.
   */
  const [consumedDeepLink, setConsumedDeepLink] = useState<string | null>(null);
  if (
    open &&
    initialConversationId &&
    initialConversationId !== consumedDeepLink
  ) {
    setConsumedDeepLink(initialConversationId);
    setActiveId(initialConversationId);
    setPane("messages");
  }

  const [consumedTicketDeepLink, setConsumedTicketDeepLink] = useState<
    string | null
  >(null);
  if (open && initialTicketId && initialTicketId !== consumedTicketDeepLink) {
    setConsumedTicketDeepLink(initialTicketId);
    setActiveTicketId(initialTicketId);
    setPane("tickets");
  }
  /* The drawer rests on the same "once per distinct link" rule as the hook
     that opens it, so its marker has to clear when the link does -- see the
     note on the same reset in useTeamMessagesChat. */
  if (!initialTicketId && consumedTicketDeepLink) setConsumedTicketDeepLink(null);

  const detailRow = activeId ? (detailRows[activeId] ?? null) : null;

  const picker = useExitTransition(pickerOpen, 160);
  const drawerRef = useRef<HTMLDivElement>(null);
  const setDrawerRef = useCallback(
    (el: HTMLDivElement | null) => {
      drawerRef.current = el;
      onRootElement?.(el);
    },
    [onRootElement],
  );
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /*
   * What the scheduler should ask for, without making the scheduler itself
   * depend on state that changes every keystroke elsewhere in the drawer.
   */
  const activeIdRef = useRef(activeId);
  const openRef = useRef(open);
  const paneRef = useRef(pane);

  const conversationsLoadedRef = useRef(conversationsLoaded);
  const detailRowRef = useRef(detailRow);

  /*
   * Declared before every effect that schedules or sends, so a tick or a
   * handler always reads the current selection. Writing these during render
   * instead would be a render side effect React does not promise to keep.
   */
  useEffect(() => {
    activeIdRef.current = activeId;
    openRef.current = open;
    paneRef.current = pane;
    conversationsLoadedRef.current = conversationsLoaded;
    detailRowRef.current = detailRow;
  }, [activeId, conversationsLoaded, detailRow, open, pane]);

  // ---------------------------------------------------------------------------
  // Central synchronization
  //
  // One request carries the conversation, and — on the slower list cadence —
  // the conversation list and the task list too. The scheduler decides when;
  // this decides what, and refuses any answer whose subject the viewer has
  // already navigated away from.
  // ---------------------------------------------------------------------------

  const applyDetail = useCallback(
    (row: TeamConversationDetailRow) => {
      setDetailRows((current) =>
        current[row.conversation_id] === row
          ? current
          : { ...current, [row.conversation_id]: row },
      );
      setDetailError(null);
      setDetailLoading(false);

      /*
       * Retire the optimistic bubbles this answer confirms, here rather than in
       * an effect watching the transcript: this is the moment the server said
       * so, and doing it on arrival keeps a long session from accumulating
       * bubbles the view has already stopped rendering.
       */
      setPendingMessages((current) => {
        if (current.length === 0) return current;
        const confirmed = toTeamConversationDetailView(
          row,
          actorProfileId,
        ).messages;
        const next = current.filter(
          (message) =>
            message.conversationId !== row.conversation_id ||
            stillPendingTeamMessages([message], confirmed).length > 0,
        );
        return next.length === current.length ? current : next;
      });
    },
    [actorProfileId],
  );

  /**
   * Whichever lane saw it first.
   *
   * The transient peek is driven from a shared snapshot keyed on each
   * conversation's last message id, so the live lane and the slower list
   * refresh cannot both announce the same message: whichever observes it first
   * records it, and the other sees no change. Repeated messages from one
   * conversation still collapse into a single card.
   *
   * The snapshot is only armed once a full list has been seen. Before that
   * every conversation looks new, and a peek per open thread on load would be
   * an announcement of history rather than of anything that just happened.
   */
  const observeConversationActivity = useCallback(
    (views: TeamConversationView[], replaceSnapshot: boolean) => {
      const nextSnapshot = replaceSnapshot
        ? new Map<string, { messageId: string | null; unreadCount: number }>()
        : conversationSnapshotRef.current;

      for (const conversation of views) {
        const previous = conversationSnapshotRef.current.get(
          conversation.conversationId,
        );
        nextSnapshot.set(conversation.conversationId, {
          messageId: conversation.lastMessageId,
          unreadCount: conversation.unreadCount,
        });

        const isNewOrdinaryMessage =
          conversationSnapshotReadyRef.current &&
          conversation.lastMessageType === "text" &&
          conversation.lastMessageId !== null &&
          conversation.lastMessageId !== previous?.messageId &&
          conversation.lastAuthorProfileId !== null &&
          conversation.lastAuthorProfileId !== actorProfileId;
        const isAlreadyViewing =
          openRef.current &&
          paneRef.current === "messages" &&
          activeIdRef.current === conversation.conversationId;

        if (isNewOrdinaryMessage && !isAlreadyViewing) {
          const increment = Math.max(
            1,
            conversation.unreadCount - (previous?.unreadCount ?? 0),
          );
          setMessagePeek((current) => ({
            conversationId: conversation.conversationId,
            conversationName: conversation.name,
            senderName: conversation.lastAuthorName ?? "A colleague",
            senderAvatarUrl: conversation.lastAuthorAvatarUrl,
            preview: conversation.preview ?? "New message",
            count:
              current?.conversationId === conversation.conversationId
                ? current.count + increment
                : increment,
            version: (current?.version ?? 0) + 1,
          }));
          setMessagePeekOpen(true);
        }
      }

      conversationSnapshotRef.current = nextSnapshot;
    },
    [actorProfileId],
  );

  /** The live lane's delta: normally empty, and never a full list. */
  const applySignals = useCallback(
    (rows: TeamConversationRow[], unreadTotal: number) => {
      if (rows.length > 0) {
        observeConversationActivity(toTeamConversationViews(rows), false);
      }
      onUnreadChange(unreadTotal);
    },
    [observeConversationActivity, onUnreadChange],
  );

  /** The background lane's full list, which is also what arms the snapshot. */
  const applyConversations = useCallback(
    (rows: TeamConversationRow[]) => {
      const views = toTeamConversationViews(rows);
      observeConversationActivity(views, true);
      conversationSnapshotReadyRef.current = true;
      setConversations(rows);
      setConversationsError(null);
      setConversationsLoaded(true);
      onUnreadChange(totalTeamUnread(views));
    },
    [observeConversationActivity, onUnreadChange],
  );

  useEffect(() => {
    if (!messagePeekOpen || !messagePeek) return;
    const timer = window.setTimeout(() => setMessagePeekOpen(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [messagePeek, messagePeekOpen]);

  const openPeekConversation = useCallback(() => {
    if (!messagePeek) return;
    setPane("messages");
    setActiveId(messagePeek.conversationId);
    setMessagePeekOpen(false);
    onRequestOpen();
  }, [messagePeek, onRequestOpen]);

  /**
   * The live lane.
   *
   * Typing, the open transcript, the unread badge and the transient peek — one
   * request, one database call, and no dependency on the conversation-list,
   * roster or task cadence. `since` is this tab's own previous answer, which is
   * what keeps the delta empty on a quiet tick.
   */
  const syncLive = useCallback(async () => {
    const requestedId =
      openRef.current && paneRef.current === "messages" ? activeIdRef.current : null;

    const result = await fetchTeamLive({
      conversationId: requestedId,
      since: liveCursorRef.current,
    });

    if (!result.ok) {
      /*
       * A background refresh stays quiet — the viewer did not ask for it, and
       * replacing a working screen with an error because one poll timed out is
       * worse than a slightly stale one. But a failure with NOTHING on screen
       * is not a refresh, it is the load, and it has to say so rather than
       * leave a skeleton spinning forever.
       */
      if (requestedId && detailRowRef.current === null) {
        setDetailError(result.error);
        setDetailLoading(false);
      }
      return { ok: false, changed: false };
    }

    liveCursorRef.current = result.data.server_time;
    applySignals(result.data.signals ?? [], result.data.unread_total);
    const signalsChanged = teamSignalsIndicateChange(result.data.signals);

    /*
     * A detail answer is only valid for the thread that was open when it was
     * asked for. Without this, a slow response for the previous conversation
     * repaints the transcript of a thread the viewer has already left — and
     * the same staleness check means a stale answer never counts as
     * "changed" either, so it cannot wrongly promote the scheduler to FAST.
     */
    let detailChanged = false;
    if (requestedId && activeIdRef.current === requestedId) {
      if (liveDetailFingerprintConversationRef.current !== requestedId) {
        liveDetailFingerprintConversationRef.current = requestedId;
        liveDetailFingerprintRef.current = "";
      }
      if (result.data.detail) {
        applyDetail(result.data.detail);
        const nextFingerprint = teamDetailFingerprint(result.data.detail);
        detailChanged = nextFingerprint !== liveDetailFingerprintRef.current;
        liveDetailFingerprintRef.current = nextFingerprint;
      }
    }

    return { ok: true, changed: signalsChanged || detailChanged };
  }, [applyDetail, applySignals]);

  /** The background lane: list, roster and the offline digest sweep. */
  const syncBackground = useCallback(
    async ({ materializeDigests }: { materializeDigests: boolean }) => {
      const result = await fetchTeamSync({
        includeConversations: true,
        includeTasks: false,
        includeTeamTasks: false,
        includeMembers: openRef.current,
        materializeDigests,
      });

      if (!result.ok) {
        if (!conversationsLoadedRef.current) {
          setConversationsError(result.error);
          setConversationsLoaded(true);
        }
        return { ok: false };
      }

      if (result.data.conversations) applyConversations(result.data.conversations);
      if (result.data.members) setMembers(result.data.members);
      return { ok: true };
    },
    [applyConversations],
  );

  /*
   * Restarting the scheduler on this key is what makes opening a thread
   * refresh at once instead of waiting for the next tick. The Tickets pane's
   * own list poll (useTicketInboxList) is separate and not part of this key.
   */
  const syncKey = `${open ? "open" : "closed"}|${activeId ?? "-"}|${pane}`;
  const { refreshNow } = useTeamSyncController({
    active: mounted,
    /*
     * The CLOSED/OPEN axis means "a Team conversation is the visible
     * surface", not "the drawer is mounted". While the drawer sits on the
     * Tickets pane the Team lanes have nothing on screen to keep fresh --
     * that pane carries its own Ticket polling -- so they take the
     * scheduler's existing CLOSED cadence instead of polling Team
     * conversations at FAST/WARM/QUIET beside it. Switching back to Messages
     * changes `syncKey` below, which wakes both lanes immediately, and the
     * tick after that is scheduled from the OPEN cadence again.
     */
    open: open && pane === "messages",
    syncKey,
    syncLive,
    syncBackground,
  });

  const ticketInboxList = useTicketInboxList(
    open && pane === "tickets" && ticketCapabilities.view,
  );

  const activeTicketIdRef = useRef(activeTicketId);
  useEffect(() => {
    activeTicketIdRef.current = activeTicketId;
  }, [activeTicketId]);

  const loadTicketDetail = useCallback(async (ticketId: string) => {
    setTicketDetailLoading(true);
    setTicketDetailError(null);
    const result = await getTicketInboxConversationAction(ticketId);
    if (activeTicketIdRef.current !== ticketId) return;
    setTicketDetailLoading(false);
    if (!result.ok) {
      setTicketDetail(null);
      setTicketDetailError(result.error);
      return;
    }
    setTicketDetail(result.data);
  }, []);

  useEffect(() => {
    if (!open || pane !== "tickets" || !activeTicketId) return;
    void (async () => {
      await loadTicketDetail(activeTicketId);
    })();
  }, [open, pane, activeTicketId, loadTicketDetail]);

  /*
   * Closes the inspector on ticket switch or pane switch. Adjusting state
   * during render (React's documented pattern for this) instead of an effect
   * -- same shape as the deep-link consumption above -- avoids the extra
   * commit an effect-driven reset would cost.
   */
  const ticketInspectorResetKey = `${pane}:${activeTicketId ?? ""}`;
  const [seenTicketInspectorResetKey, setSeenTicketInspectorResetKey] =
    useState(ticketInspectorResetKey);
  if (seenTicketInspectorResetKey !== ticketInspectorResetKey) {
    setSeenTicketInspectorResetKey(ticketInspectorResetKey);
    if (ticketInspectorOpen) setTicketInspectorOpen(false);
  }

  useEffect(() => {
    if (!open || pane !== "tickets" || !ticketCapabilities.view) return;
    let cancelled = false;
    void (async () => {
      const result = await listTicketAssigneesAction();
      if (!cancelled && result.ok) setTicketAssignees(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pane, ticketCapabilities.view]);

  const selectTicket = useCallback((ticketId: string) => {
    setActiveTicketId(ticketId);
  }, []);

  // ---------------------------------------------------------------------------
  // Interactive loaders. These raise spinners and surface errors, which a
  // background sync must never do on the viewer's behalf.
  // ---------------------------------------------------------------------------

  const loadDetail = useCallback(
    async (conversationId: string, isCurrent: StaleGuard = alwaysCurrent) => {
      setDetailLoading(true);
      const result = await fetchTeamLive({
        conversationId,
        /*
         * No cursor. An interactive open asks only for this thread; letting it
         * advance the shared delta cursor would let it swallow activity the
         * live lane has not reported yet.
         */
        since: null,
      });
      if (!isCurrent() || activeIdRef.current !== conversationId) return;

      if (result.ok && result.data.detail) applyDetail(result.data.detail);
      else {
        setDetailError(result.ok ? "Conversation could not be loaded." : result.error);
        setDetailRows((current) => {
          const next = { ...current };
          delete next[conversationId];
          return next;
        });
        setDetailLoading(false);
      }
    },
    [applyDetail],
  );

  /**
   * "Load older": one keyset page strictly before whatever is currently the
   * oldest loaded message for this conversation, cursored on
   * (created_at, id) rather than OFFSET. Guarded against overlapping calls
   * and against a conversation already known to be exhausted.
   */
  const loadOlderMessages = useCallback(async () => {
    const conversationId = activeIdRef.current;
    if (!conversationId || loadingOlderRef.current) return;
    if (hasMoreOlder[conversationId] === false) return;

    const baseRow = detailRows[conversationId];
    const currentMessages = mergeTeamMessageViews(
      olderMessages[conversationId] ?? [],
      baseRow ? toTeamMessageViews(baseRow.messages, actorProfileId) : [],
    );
    const oldest = currentMessages[0];
    if (!oldest) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const result = await listTeamMessagesBeforeAction({
      conversationId,
      beforeCreatedAt: oldest.createdAt,
      beforeId: oldest.id,
      limit: 50,
    });

    loadingOlderRef.current = false;
    setLoadingOlder(false);
    if (!result.ok) return;

    const fetchedViews = toTeamMessageViews(result.data.messages, actorProfileId);
    setOlderMessages((current) => ({
      ...current,
      [conversationId]: mergeTeamMessageViews(current[conversationId] ?? [], fetchedViews),
    }));
    setHasMoreOlder((current) => ({ ...current, [conversationId]: result.data.has_more }));
  }, [actorProfileId, detailRows, hasMoreOlder, olderMessages]);

  /**
   * The minimum architecture a search result click needs: fetch a bounded
   * window around the target only when it is not already loaded, then flash
   * it — the same highlight mechanism task-source-message navigation already
   * uses, so a historical message from eight months ago is reached exactly
   * the same way as one from an hour ago.
   */
  const jumpToMessage = useCallback(
    async (conversationId: string, messageId: string) => {
      const alreadyLoaded =
        (detailRows[conversationId]?.messages ?? []).some((message) => message.id === messageId) ||
        (olderMessages[conversationId] ?? []).some((message) => message.id === messageId);

      if (!alreadyLoaded) {
        const result = await getTeamMessageWindowAction({ conversationId, messageId });
        if (result.ok && result.data.found) {
          const views = toTeamMessageViews(result.data.messages, actorProfileId);
          setOlderMessages((current) => ({
            ...current,
            [conversationId]: mergeTeamMessageViews(current[conversationId] ?? [], views),
          }));
        }
      }

      setHighlightMessageId(messageId);
    },
    [actorProfileId, detailRows, olderMessages],
  );

  const jumpToSearchResult = useCallback(
    (result: TeamSearchResultView) => {
      const conversationId = activeIdRef.current;
      if (!conversationId) return;
      void jumpToMessage(conversationId, result.id);
    },
    [jumpToMessage],
  );

  const openSearch = useCallback(() => {
    setSearchConversationId(activeIdRef.current);
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  /**
   * Reaction toggle. The rail/chip click applies the predicted aggregate on
   * the same frame; the override is cleared the instant the request settles,
   * because either the following `refreshNow()` brings the true aggregate
   * (success) or the override simply reverting to the server's last known
   * state IS the correct rollback (failure).
   */
  const toggleReaction = useCallback(
    async (message: TeamMessageView, code: TeamReactionCode) => {
      const predicted = applyOptimisticTeamReactionToggle(message, code, actorName).reactions;
      setReactionOverrides((current) => ({ ...current, [message.id]: predicted }));

      const result = await toggleTeamMessageReactionAction({
        messageId: message.id,
        reactionCode: code,
      });

      setReactionOverrides((current) => {
        if (!(message.id in current)) return current;
        const next = { ...current };
        delete next[message.id];
        return next;
      });

      if (!result.ok) {
        setDetailError(result.error);
        return;
      }

      /*
       * For a message the live lane resends every tick (inside the latest
       * loaded window), refreshNow() below brings the authoritative
       * reactions and the cleared override above is enough. But a message
       * reached through search/"load older" lives in `olderMessages`, which
       * NOTHING else ever refreshes — clearing the override there would
       * silently revert to whatever reactions were cached at load time.
       * Patching the cached row directly (a no-op for in-window messages,
       * where no matching id exists in this map) is what makes a historical
       * message's reaction durable after this render.
       */
      const confirmedReactions = toTeamReactionViews(result.data.reactions);
      setOlderMessages((current) => {
        const bucket = current[message.conversationId];
        if (!bucket) return current;
        const index = bucket.findIndex((existing) => existing.id === message.id);
        if (index === -1) return current;
        const nextBucket = [...bucket];
        nextBucket[index] = { ...nextBucket[index]!, reactions: confirmedReactions };
        return { ...current, [message.conversationId]: nextBucket };
      });

      await refreshNow();
    },
    [actorName, refreshNow],
  );

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /* Opening a thread clears its unread state for this member and nobody else. */
  useEffect(() => {
    if (!open || !activeId) return;

    let alive = true;
    void (async () => {
      const result = await markTeamConversationReadAction(activeId);
      if (alive && result.ok) await refreshNow();
    })();

    return () => {
      alive = false;
    };
  }, [activeId, open, refreshNow]);

  /*
   * Typing. One opaque connection id per open drawer, refreshed while the
   * viewer is actually composing and cleared the moment they are not — on an
   * empty draft, on send, on close, and on unmount.
   *
   * There is no timer here: the heartbeat is throttled by the keystroke that
   * triggers it, so a still composer costs nothing.
   */
  const typingConnectionRef = useRef<string | null>(null);
  const typingSentAtRef = useRef(0);
  const typingConversationRef = useRef<string | null>(null);
  const typingRequestRef = useRef<Promise<void>>(Promise.resolve());

  const queueTyping = useCallback(
    (
      operation: "touch" | "clear",
      conversationId: string,
      connectionId: string,
    ) => {
      typingRequestRef.current = typingRequestRef.current.then(() =>
        sendTeamTyping({ operation, conversationId, connectionId }),
      );
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    typingConnectionRef.current = randomUuid();

    return () => {
      const connectionId = typingConnectionRef.current;
      const conversationId = typingConversationRef.current;
      typingConnectionRef.current = null;
      typingConversationRef.current = null;
      typingSentAtRef.current = 0;
      if (connectionId && conversationId) {
        queueTyping("clear", conversationId, connectionId);
      }
    };
  }, [open, queueTyping]);

  const stopTyping = useCallback(() => {
    const connectionId = typingConnectionRef.current;
    const conversationId = typingConversationRef.current;
    if (!connectionId || !conversationId) return;
    typingConversationRef.current = null;
    typingSentAtRef.current = 0;
    queueTyping("clear", conversationId, connectionId);
  }, [queueTyping]);

  const noteTyping = useCallback(
    (draft: string) => {
      const connectionId = typingConnectionRef.current;
      const conversationId = activeIdRef.current;
      if (!connectionId || !conversationId) return;

      if (draft.trim() === "") {
        stopTyping();
        return;
      }

      const now = Date.now();
      if (
        typingConversationRef.current === conversationId &&
        now - typingSentAtRef.current < TYPING_HEARTBEAT_MS
      ) {
        return;
      }

      /* Leaving a draft behind in another thread must not keep it "typing". */
      if (
        typingConversationRef.current &&
        typingConversationRef.current !== conversationId
      ) {
        stopTyping();
      }

      typingConversationRef.current = conversationId;
      typingSentAtRef.current = now;
      queueTyping("touch", conversationId, connectionId);
    },
    [queueTyping, stopTyping],
  );

  /* Leaving a thread stops announcing a draft that is no longer on screen. */
  useEffect(() => {
    if (typingConversationRef.current && typingConversationRef.current !== activeId) {
      stopTyping();
    }
  }, [activeId, stopTyping]);

  /* Remember where focus came from, so it can be handed back on close. */
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  /* Escape closes the drawer; Tab stays inside it. */
  useEffect(() => {
    if (!render) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pickerOpen) {
          setPickerOpen(false);
          return;
        }
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, pickerOpen, render]);

  /* The page behind a modal surface must not scroll under it. */
  useEffect(() => {
    if (!render) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [render]);

  /* Focus returns to the trigger only once the outro has finished. */
  useEffect(() => {
    if (render) return;
    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
  }, [render]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Send.
   *
   * The bubble appears and the composer clears on the same frame as the click:
   * the round trip happens behind an optimistic message that already sits in
   * the transcript, in the position it will keep. The `requestId` is both the
   * idempotency key the database dedupes on and the handle the confirmed row is
   * matched back to, so a retry cannot produce a second message and two
   * genuinely identical drafts stay two messages.
   */
  const send = useCallback(
    async (body: string, retryOf?: TeamMessageView, reply?: TeamReplyDraft | null) => {
      const conversationId = retryOf?.conversationId ?? activeIdRef.current;
      if (!conversationId) return;

      const requestId = retryOf?.requestId ?? randomUuid();
      const activeReply = retryOf?.replyToMessageId
        ? {
            sourceMessageId: retryOf.replyToMessageId,
            authorName: retryOf.replySourceAuthorName ?? "A colleague",
            quoteText: retryOf.replyQuoteText ?? "",
          }
        : reply ?? null;

      const optimistic: TeamMessageView = {
        id: `pending-${requestId}`,
        requestId,
        conversationId,
        authorProfileId: actorProfileId,
        authorName: actorName ?? "You",
        authorAvatarUrl: null,
        authorInitials: teamInitials(actorName),
        body,
        messageType: "text",
        taskId: null,
        taskAction: null,
        createdAt: new Date().toISOString(),
        isMine: true,
        pending: true,
        reactions: [],
        replyToMessageId: activeReply?.sourceMessageId ?? null,
        replyQuoteText: activeReply?.quoteText ?? null,
        replySourceAuthorName: activeReply?.authorName ?? null,
        replySourceDeleted: false,
        forwardedFromMessageId: null,
        forwardedFromAuthorName: null,
        deletedForEveryone: false,
      };

      setPendingMessages((current) => [
        ...current.filter((message) => message.requestId !== requestId),
        optimistic,
      ]);
      stopTyping();

      const result = activeReply
        ? await sendTeamReplyAction({
            requestId,
            conversationId,
            body,
            replyToMessageId: activeReply.sourceMessageId,
            replyQuoteText: activeReply.quoteText,
          })
        : await sendTeamMessageAction({ requestId, conversationId, body });

      if (!result.ok) {
        /*
         * The draft is not lost and not silently retried: the bubble stays put,
         * marked Not sent, and offers the retry itself.
         */
        setPendingMessages((current) =>
          current.map((message) =>
            message.requestId === requestId
              ? { ...message, pending: false, failed: true }
              : message,
          ),
        );
        setDetailError(result.error);
        /*
         * A refusal can mean a Slow Mode cooldown just became active (or a
         * stale second tab's local countdown had already expired server-side
         * either direction) — refresh so `my_next_allowed_send_at` is
         * authoritative again rather than leaving the composer trusting a
         * guess from before this attempt.
         */
        await refreshNow();
        return;
      }

      setDetailError(null);
      await refreshNow();
    },
    [actorName, actorProfileId, refreshNow, stopTyping],
  );

  const startConversation = useCallback(
    async (otherProfileId: string) => {
      setCreatorBusy(true);
      setCreatorError(null);
      const result = await startTeamConversationAction(otherProfileId);
      setCreatorBusy(false);

      if (!result.ok) {
        setCreatorError(result.error);
        return;
      }

      setPickerOpen(false);
      setPane("messages");
      setActiveId(result.data);
    },
    [],
  );

  const createGroup = useCallback(
    async (title: string, memberProfileIds: string[]) => {
      setCreatorBusy(true);
      setCreatorError(null);
      const result = await createTeamGroupAction({ title, memberProfileIds });
      setCreatorBusy(false);

      if (!result.ok) {
        setCreatorError(result.error);
        return;
      }

      setPickerOpen(false);
      setPane("messages");
      setActiveId(result.data);
    },
    [],
  );

  const submitTask = useCallback(
    async (draft: TeamTaskDraft) => {
      const conversationId = activeIdRef.current;
      if (!conversationId) return;

      setComposerSubmitting(true);
      setComposerError(null);

      const result = await createTeamTaskAction({
        requestId: randomUuid(),
        conversationId,
        title: draft.title,
        assignedToProfileId: draft.assignedToProfileId,
        description: draft.description,
        priority: draft.priority,
        dueAt: draft.dueAt,
        sourceMessageId: draft.sourceMessageId,
      });

      setComposerSubmitting(false);

      if (!result.ok) {
        setComposerError(result.error);
        return;
      }

      setComposer(null);
      await refreshNow();
    },
    [refreshNow],
  );

  const changeTaskStatus = useCallback(
    async (taskId: string, status: TeamTaskStatus) => {
      setBusyTaskId(taskId);
      const result = await updateTeamTaskStatusAction({ taskId, status });
      setBusyTaskId(null);

      if (!result.ok) {
        setDetailError(result.error);
        return;
      }

      /* Completion writes a conversation event and a notification; show both now. */
      await refreshNow();
    },
    [refreshNow],
  );

  const openComposer = useCallback((sourceMessage: TeamMessageView | null) => {
    setComposerError(null);
    setComposer({ key: randomUuid(), sourceMessage });
  }, []);

  const forwardMessage = useCallback(async (
    message: TeamMessageView,
    destinationConversationId: string,
  ): Promise<string | null> => {
    const result = await forwardTeamMessageAction({
      requestId: randomUuid(),
      sourceMessageId: message.id,
      destinationConversationId,
    });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  const hideMessageForMe = useCallback(async (
    message: TeamMessageView,
  ): Promise<string | null> => {
    const result = await hideTeamMessageForMeAction(message.id);
    if (!result.ok) return result.error;

    setDetailRows((current) => {
      const row = current[message.conversationId];
      if (!row) return current;
      return {
        ...current,
        [message.conversationId]: {
          ...row,
          messages: row.messages.filter((existing) => existing.id !== message.id),
        },
      };
    });
    setOlderMessages((current) => ({
      ...current,
      [message.conversationId]: (current[message.conversationId] ?? [])
        .filter((existing) => existing.id !== message.id),
    }));
    setSearchOpen(false);
    await refreshNow();
    return null;
  }, [refreshNow]);

  const deleteMessageForEveryone = useCallback(async (
    message: TeamMessageView,
  ): Promise<string | null> => {
    const result = await deleteTeamMessageForEveryoneAction(message.id);
    if (!result.ok) return result.error;

    const tombstone = (existing: TeamMessageView): TeamMessageView => {
      if (existing.id === message.id) {
        return {
          ...existing,
          body: "",
          deletedForEveryone: true,
          reactions: [],
          replyQuoteText: null,
        };
      }
      if (existing.replyToMessageId === message.id) {
        return { ...existing, replyQuoteText: null, replySourceDeleted: true };
      }
      return existing;
    };
    const tombstoneRow = (existing: TeamMessageRow): TeamMessageRow => {
      if (existing.id === message.id) {
        return {
          ...existing,
          body: "",
          deleted_for_everyone: true,
          reactions: [],
          reply_quote_text: null,
        };
      }
      if (existing.reply_to_message_id === message.id) {
        return { ...existing, reply_quote_text: null, reply_source_deleted: true };
      }
      return existing;
    };

    setDetailRows((current) => {
      const row = current[message.conversationId];
      if (!row) return current;
      return {
        ...current,
        [message.conversationId]: {
          ...row,
          messages: row.messages.map(tombstoneRow),
        },
      };
    });
    setOlderMessages((current) => ({
      ...current,
      [message.conversationId]: (current[message.conversationId] ?? []).map(tombstone),
    }));
    setSearchOpen(false);
    await refreshNow();
    return null;
  }, [refreshNow]);

  // ---------------------------------------------------------------------------
  // Governance (V2.6)
  //
  // Every RPC re-derives and re-checks owner/delegated authority itself; these
  // wrappers only shape the request and refresh the open thread's detail
  // (which carries owner, admins, Slow Mode and task policy) on success.
  // ---------------------------------------------------------------------------

  const renameConversation = useCallback(async (
    conversationId: string,
    title: string,
  ): Promise<string | null> => {
    const result = await renameTeamConversationAction({ conversationId, title });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  const setConversationSlowMode = useCallback(async (
    conversationId: string,
    seconds: number | null,
    scope: TeamSlowModeScope,
  ): Promise<string | null> => {
    const result = await setTeamConversationSlowModeAction({ conversationId, seconds, scope });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  const setConversationTaskCreationPolicy = useCallback(async (
    conversationId: string,
    policy: TeamTaskCreationPolicy,
  ): Promise<string | null> => {
    const result = await setTeamTaskCreationPolicyAction({ conversationId, policy });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  const grantConversationAdmin = useCallback(async (
    conversationId: string,
    targetProfileId: string,
    capabilities: Partial<Record<TeamConversationCapability, boolean>>,
  ): Promise<string | null> => {
    const result = await grantTeamConversationAdminAction({
      conversationId,
      targetProfileId,
      capabilities,
    });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  const revokeConversationAdmin = useCallback(async (
    conversationId: string,
    targetProfileId: string,
  ): Promise<string | null> => {
    const result = await revokeTeamConversationAdminAction({ conversationId, targetProfileId });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  const addConversationMember = useCallback(async (
    conversationId: string,
    profileId: string,
  ): Promise<string | null> => {
    const result = await addTeamConversationMemberAction({ conversationId, profileId });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  const removeConversationMember = useCallback(async (
    conversationId: string,
    profileId: string,
  ): Promise<string | null> => {
    const result = await removeTeamConversationMemberAction({ conversationId, profileId });
    if (!result.ok) return result.error;
    await refreshNow();
    return null;
  }, [refreshNow]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const conversationViews = useMemo(
    () => toTeamConversationViews(conversations),
    [conversations],
  );

  const unreadTotal = useMemo(
    () => totalTeamUnread(conversationViews),
    [conversationViews],
  );

  const memberViews = useMemo(() => toTeamMemberViews(members), [members]);

  /*
   * Confirmed messages plus anything still in flight, in one transcript.
   *
   * The combined list is re-grouped rather than having pending bubbles appended
   * to the last group, so a message still sending sits exactly where it will
   * once the server confirms it — the bubble does not jump when the round trip
   * lands, and it is never shown twice.
   */
  const detail: TeamConversationDetailView | null = useMemo(() => {
    if (!detailRow) return null;

    const base = toTeamConversationDetailView(detailRow, actorProfileId);
    const mine = pendingMessages.filter(
      (pending) => pending.conversationId === detailRow.conversation_id,
    );
    const unconfirmed = stillPendingTeamMessages(mine, base.messages);
    const older = olderMessages[detailRow.conversation_id] ?? [];
    const hasOverrides = Object.keys(reactionOverrides).length > 0;

    if (unconfirmed.length === 0 && older.length === 0 && !hasOverrides) return base;

    let messages = older.length > 0 ? mergeTeamMessageViews(older, base.messages) : base.messages;
    if (unconfirmed.length > 0) messages = mergeTeamMessageViews(messages, unconfirmed);
    if (hasOverrides) {
      messages = messages.map((message) =>
        reactionOverrides[message.id] ? { ...message, reactions: reactionOverrides[message.id]! } : message,
      );
    }

    return { ...base, messages, groups: groupTeamMessages(messages) };
  }, [actorProfileId, detailRow, olderMessages, pendingMessages, reactionOverrides]);

  /**
   * Who a task in this conversation may be assigned to.
   *
   * Every member of the open thread, which for a group is the whole group and
   * for a direct thread is still exactly two people. The list is a convenience
   * only: the database re-checks that the assignee is a member of the
   * conversation, so an edited request gains nothing.
   */
  const assignableMembers: TeamMemberView[] = useMemo(() => {
    const me: TeamMemberView = {
      profileId: actorProfileId,
      name: actorName ? `${actorName} (you)` : "You",
      email: null,
      avatarUrl: null,
      initials: teamInitials(actorName),
    };

    const others = (detail?.members ?? []).filter(
      (member) => member.profileId !== actorProfileId,
    );
    if (others.length > 0) return [me, ...others];

    const other = detail?.otherMember;
    return other ? [me, other] : [me];
  }, [actorName, actorProfileId, detail?.members, detail?.otherMember]);

  if (!mounted) return null;

  const messagePeekNode =
    messagePeekTransition.render && messagePeek ? (
      <button
        type="button"
        className={[
          styles.messagePeek,
          messagePeekTransition.phase === "closing"
            ? styles.messagePeekClosing
            : styles.messagePeekOpen,
        ].join(" ")}
        onClick={openPeekConversation}
        aria-label={`Open ${messagePeek.conversationName}: ${messagePeek.preview}`}
      >
        <TeamAvatar
          name={messagePeek.senderName}
          initials={teamInitials(messagePeek.senderName)}
          avatarUrl={messagePeek.senderAvatarUrl}
        />
        <span className={styles.messagePeekBody}>
          <span className={styles.messagePeekTopline}>
            <strong>{messagePeek.senderName}</strong>
            {messagePeek.count > 1 ? (
              <span className={styles.messagePeekCount}>
                {messagePeek.count} unread
              </span>
            ) : null}
          </span>
          {messagePeek.conversationName !== messagePeek.senderName ? (
            <span className={styles.messagePeekConversation}>
              {messagePeek.conversationName}
            </span>
          ) : null}
          <span className={styles.messagePeekPreview}>{messagePeek.preview}</span>
        </span>
      </button>
    ) : null;

  if (!render) {
    return messagePeekNode
      ? createPortal(messagePeekNode, document.body)
      : null;
  }

  const closing = phase === "closing";
  /* At mobile width one pane shows at a time; at desktop width both do. */
  const showListOnMobile =
    (pane === "messages" && !activeId) ||
    (pane === "tickets" && !activeTicketId);

  return createPortal(
    <>
      {messagePeekNode}
      <div
        className={[
          styles.backdrop,
          closing ? styles.backdropClosing : styles.backdropOpen,
        ].join(" ")}
        onMouseDown={onClose}
        aria-hidden="true"
      />

      <div
        ref={setDrawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Inbox"
        className={[
          styles.drawer,
          closing ? styles.drawerClosing : styles.drawerOpen,
        ].join(" ")}
      >
        <aside
          className={[
            styles.listPane,
            showListOnMobile ? "" : styles.listPaneHidden,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className={styles.listHeader}>
            <h2>Inbox</h2>
          </div>

          <div className={styles.tabDock}>
            <div className={styles.tabs}>
              {canUseTeamMessages ? (
                <button
                  type="button"
                  className={[
                    styles.tab,
                    pane === "messages" ? styles.tabActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={pane === "messages"}
                  onClick={() => setPane("messages")}
                >
                  <MessageSquare aria-hidden="true" width={13} height={13} />
                  Messages
                  {unreadTotal > 0 ? (
                    <span
                      className={`${styles.tabCount} ${styles.tabCountAccent}`}
                    >
                      {unreadTotal}
                    </span>
                  ) : null}
                </button>
              ) : null}

              {ticketCapabilities.view ? (
                <button
                  type="button"
                  className={[
                    styles.tab,
                    pane === "tickets" ? styles.tabActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={pane === "tickets"}
                  onClick={() => {
                    /* The pencil is a Messages-only affordance and unmounts
                       with the pane, so an open creator menu would be left
                       with no anchor. */
                    setPickerOpen(false);
                    setPane("tickets");
                  }}
                >
                  <TicketIcon aria-hidden="true" width={13} height={13} />
                  Tickets
                </button>
              ) : null}

              {canUseTeamMessages && pane === "messages" ? (
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.tabAction}`}
                  onClick={() => {
                    setCreatorError(null);
                    setPickerOpen((value) => !value);
                  }}
                  aria-label="Start a new conversation or group"
                  aria-expanded={pickerOpen}
                  aria-haspopup="dialog"
                  title="New conversation"
                >
                  <PenLine aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {picker.render ? (
              <div
                role="dialog"
                aria-label="Start a conversation"
                className={[
                  styles.menu,
                  picker.phase === "closing"
                    ? styles.menuClosing
                    : styles.menuOpen,
                ].join(" ")}
              >
                <TeamConversationCreator
                  members={memberViews}
                  statusFor={statusFor}
                  onStartDirect={(profileId) =>
                    void startConversation(profileId)
                  }
                  onCreateGroup={(title, memberProfileIds) =>
                    void createGroup(title, memberProfileIds)
                  }
                  busy={creatorBusy}
                  error={creatorError}
                />
              </div>
            ) : null}
          </div>

          {pane === "messages" ? (
            <div className={styles.listScroll}>
              {conversationsError ? (
                <div
                  className={styles.inlineError}
                  role="alert"
                  style={{ margin: "0 0 8px" }}
                >
                  <AlertCircle aria-hidden="true" />
                  <span>{conversationsError}</span>
                  <button
                    type="button"
                    className={styles.inlineErrorRetry}
                    onClick={() => void refreshNow()}
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              {!conversationsLoaded && conversations.length === 0 ? (
                <div className={styles.skeletonList} aria-busy="true">
                  <div className={styles.skeletonRow} />
                  <div className={styles.skeletonRow} />
                  <div className={styles.skeletonRow} />
                </div>
              ) : null}

              {conversationsLoaded &&
              conversationViews.length === 0 &&
              !conversationsError ? (
                <div className={styles.stateBlock}>
                  <span className={styles.stateIcon}>
                    <Inbox aria-hidden="true" />
                  </span>
                  <strong>No conversations yet</strong>
                  <p>Start one with a colleague using the pencil above.</p>
                </div>
              ) : null}

              {conversationViews.map((conversation) => (
                <ConversationRow
                  key={conversation.conversationId}
                  conversation={conversation}
                  active={
                    conversation.conversationId === activeId &&
                    pane === "messages"
                  }
                  onSelect={() => {
                    setPane("messages");
                    setActiveId(conversation.conversationId);
                    if (messagePeek?.conversationId === conversation.conversationId) {
                      setMessagePeekOpen(false);
                    }
                  }}
                  presence={
                    conversation.otherMember
                      ? statusFor(conversation.otherMember.profileId)
                      : "unknown"
                  }
                />
              ))}
            </div>
          ) : (
            <TeamTicketsPane
              tickets={ticketInboxList.tickets}
              loading={!ticketInboxList.loaded && ticketInboxList.tickets.length === 0}
              error={ticketInboxList.error}
              activeTicketId={activeTicketId}
              onSelect={selectTicket}
              onRetry={ticketInboxList.refreshNow}
            />
          )}
        </aside>

        {pane === "tickets" ? (
          <div
            className={[
              styles.conversationPaneWrap,
              styles.conversationPaneWrapTicket,
              showListOnMobile ? styles.conversationPaneHidden : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {activeTicketId && ticketDetail ? (
              <>
                <div className={styles.paneHeader}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.backButton}`}
                    onClick={() => setActiveTicketId(null)}
                    aria-label="Back to Tickets"
                  >
                    <ArrowLeft aria-hidden="true" />
                  </button>
                  <div className={styles.paneHeaderText}>
                    <strong>{ticketDetail.ticket.subject}</strong>
                    <span>Ticket {ticketDetail.ticket.public_ref}</span>
                  </div>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.detailsButton}`}
                    onClick={() => setTicketInspectorOpen((current) => !current)}
                    aria-label="Ticket details"
                    aria-pressed={ticketInspectorOpen}
                  >
                    <Info aria-hidden="true" />
                  </button>
                </div>
                <TicketAdminConversation
                  ticketId={ticketDetail.ticket.id}
                  heading={ticketDetail.ticket.subject}
                  contactName={ticketDetail.client_name ?? ticketDetail.company_name}
                  messages={ticketDetail.messages}
                  viewerProfileId={actorProfileId}
                  destinations={
                    canUseTeamMessages ? toTeamConversationViews(conversations) : []
                  }
                  canReply={ticketCapabilities.reply}
                  canReact={ticketCapabilities.reply}
                  repliesDisabled={
                    ticketDetail.ticket.status === "closed" ||
                    Boolean(ticketDetail.ticket.archived_at)
                  }
                />
              </>
            ) : activeTicketId && ticketDetailLoading ? (
              <div className={styles.skeletonList} aria-busy="true">
                <div className={styles.skeletonRow} />
                <div className={styles.skeletonRow} />
                <div className={styles.skeletonRow} />
              </div>
            ) : activeTicketId && ticketDetailError ? (
              <div className={`${styles.stateBlock} ${styles.stateError}`}>
                <span className={styles.stateIcon}>
                  <AlertCircle aria-hidden="true" />
                </span>
                <strong>Ticket could not be loaded</strong>
                <p>{ticketDetailError}</p>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadTicketDetail(activeTicketId)}
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className={styles.stateBlock}>
                <span className={styles.stateIcon}>
                  <TicketIcon aria-hidden="true" />
                </span>
                <strong>Select a Ticket</strong>
                <p>Choose a Ticket from the list to open its conversation.</p>
              </div>
            )}
          </div>
        ) : (
          <div
            className={[
              styles.conversationPaneWrap,
              showListOnMobile ? styles.conversationPaneHidden : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <TeamConversationPane
              detail={detail}
              actorProfileId={actorProfileId}
              canManageTasks={canManageTasks}
              roster={memberViews}
              loading={
                detailLoading ||
                Boolean(activeId && !detailRow && !detailError)
              }
              error={detailError}
              onRetry={() => activeId && void loadDetail(activeId)}
              onBack={() => setActiveId(null)}
              onSend={(body, reply) => void send(body, undefined, reply)}
              onRetryMessage={(message) =>
                void send(message.body, message, null)
              }
              onDraftChange={noteTyping}
              onCreateTaskFromComposer={() => openComposer(null)}
              onCloseDrawer={onClose}
              onCreateTaskFromMessage={openComposer}
              onTaskStatusChange={(taskId, status) =>
                void changeTaskStatus(taskId, status)
              }
              busyTaskId={busyTaskId}
              highlightMessageId={highlightMessageId}
              onHighlightConsumed={() => setHighlightMessageId(null)}
              presenceStatus={
                detail?.otherMember
                  ? statusFor(detail.otherMember.profileId)
                  : "unknown"
              }
              onLoadOlder={loadOlderMessages}
              loadingOlder={loadingOlder}
              hasMoreOlder={
                activeId
                  ? (hasMoreOlder[activeId] ?? (detailRows[activeId]?.messages.length ?? 0) >= 300)
                  : false
              }
              searchOpen={searchOpen && activeId === searchConversationId}
              onOpenSearch={openSearch}
              onCloseSearch={closeSearch}
              onJumpToSearchResult={jumpToSearchResult}
              onReact={(message, code) => void toggleReaction(message, code)}
              forwardDestinations={conversationViews}
              onForward={forwardMessage}
              onDeleteForMe={hideMessageForMe}
              onDeleteForEveryone={deleteMessageForEveryone}
              onJumpToMessage={(messageId) => {
                const conversationId = activeIdRef.current;
                if (conversationId) void jumpToMessage(conversationId, messageId);
              }}
              onRenameConversation={(title) =>
                detail
                  ? renameConversation(detail.conversationId, title)
                  : Promise.resolve("No conversation is open.")
              }
              onSetSlowMode={(seconds, scope) =>
                detail
                  ? setConversationSlowMode(detail.conversationId, seconds, scope)
                  : Promise.resolve("No conversation is open.")
              }
              onSetTaskCreationPolicy={(policy) =>
                detail
                  ? setConversationTaskCreationPolicy(detail.conversationId, policy)
                  : Promise.resolve("No conversation is open.")
              }
              onGrantAdmin={(targetProfileId, capabilities) =>
                detail
                  ? grantConversationAdmin(detail.conversationId, targetProfileId, capabilities)
                  : Promise.resolve("No conversation is open.")
              }
              onRevokeAdmin={(targetProfileId) =>
                detail
                  ? revokeConversationAdmin(detail.conversationId, targetProfileId)
                  : Promise.resolve("No conversation is open.")
              }
              onAddMember={(profileId) =>
                detail
                  ? addConversationMember(detail.conversationId, profileId)
                  : Promise.resolve("No conversation is open.")
              }
              onRemoveMember={(profileId) =>
                detail
                  ? removeConversationMember(detail.conversationId, profileId)
                  : Promise.resolve("No conversation is open.")
              }
              onConversationChanged={() => {
                const conversationId = activeIdRef.current;
                if (conversationId) void loadDetail(conversationId);
              }}
            />
          </div>
        )}

        {pane === "tickets" && activeTicketId && ticketDetail ? (
          <aside
            className={[
              styles.inspectorPane,
              ticketInspectorOpen ? styles.inspectorPaneOpen : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label="Ticket details and controls"
          >
            <div className={styles.paneHeader}>
              <strong>Details</strong>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.detailsButton}`}
                onClick={() => setTicketInspectorOpen(false)}
                aria-label="Close Ticket details"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <TicketInspector
              detail={ticketDetail}
              assignees={ticketAssignees}
              capabilities={ticketCapabilities}
              onTicketChanged={() => void loadTicketDetail(ticketDetail.ticket.id)}
            />
          </aside>
        ) : null}

        {(pane === "messages" ? !detail : !(activeTicketId && ticketDetail)) ? (
          <button
            type="button"
            className={`${styles.iconButton} ${styles.closeButton}`}
            onClick={onClose}
            aria-label="Close Inbox"
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/*
        Keyed on the open session, so each open mounts a composer whose fields
        start from their initializers rather than being reset by an effect.
        `open` stays true for the whole session, which is what lets the outro
        play when it is set back to null.
      */}
      <TeamTaskComposer
        key={composer?.key ?? "closed"}
        open={composer !== null}
        onClose={() => setComposer(null)}
        onSubmit={(draft) => void submitTask(draft)}
        members={assignableMembers}
        defaultAssigneeId={
          detail?.otherMember?.profileId ??
          assignableMembers[1]?.profileId ??
          actorProfileId
        }
        sourceMessage={composer?.sourceMessage ?? null}
        submitting={composerSubmitting}
        error={composerError}
      />
    </>,
    document.body,
  );
}

/**
 * One row in the conversation list.
 *
 * Direct and group threads share this row: a group has no single other member,
 * so it identifies itself by name and member count instead of by avatar and
 * presence. Every text cell is a real flex/grid minimum-zero cell — a long
 * preview ellipsizes inside the card rather than pushing through its border.
 */
function ConversationRow({
  conversation,
  active,
  onSelect,
  presence,
}: {
  conversation: TeamConversationView;
  active: boolean;
  onSelect: () => void;
  presence: TeamPresenceStatus;
}) {
  const isGroup = conversation.kind === "group";

  return (
    <button
      type="button"
      className={[
        styles.conversationRow,
        active ? styles.conversationRowActive : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      {isGroup ? (
        <TeamConversationAvatar imageUrl={conversation.imageUrl} />
      ) : (
        <TeamAvatar
          name={conversation.otherMember?.name ?? conversation.name}
          initials={conversation.otherMember?.initials ?? ""}
          avatarUrl={conversation.otherMember?.avatarUrl ?? null}
          presence={presence}
        />
      )}

      <span className={styles.conversationBody}>
        <span className={styles.conversationTop}>
          <span
            className={[
              styles.conversationName,
              conversation.hasUnread ? styles.conversationNameUnread : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {conversation.name}
          </span>
          <span className={styles.conversationTime}>
            {formatTeamRelativeTime(conversation.lastMessageAt)}
          </span>
        </span>

        <span
          className={[
            styles.conversationPreview,
            conversation.hasUnread ? styles.conversationPreviewUnread : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className={styles.conversationPreviewText}>
            {isGroup ? (
              <span className={styles.conversationGroupCount}>
                {conversation.memberCount} members ·{" "}
              </span>
            ) : null}
            {conversation.preview ?? "No messages yet"}
          </span>
          {conversation.hasUnread ? (
            <span
              className={styles.unreadPip}
              aria-label={`${conversation.unreadCount} unread`}
            >
              {conversation.unreadCount > 9 ? "9+" : conversation.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
