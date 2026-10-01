"use client";

import { CheckCircle2, Forward, Mic, RotateCw, Settings } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  getSupervisedConversationAction,
  listSupervisedMessagesBeforeAction,
} from "../../app/actions/team-supervision";
import type {
  SupervisedMessage,
  SupervisedMessageCursor,
  SupervisedTranscriptPage,
} from "../../domain/team-supervision/projections";
import type { ClientSafeError } from "../../lib/errors/application-error";
import {
  formatTeamDayHeading,
  formatTeamMessageTime,
  teamInitials,
} from "../../domain/team/projections";
import { teamReactionEmoji, type TeamReactionCode } from "../../domain/team/schema";
import { TeamAvatar } from "../team/team-avatar";
import { TeamFormattedMessage } from "../team/team-formatted-message";
import styles from "./supervised-transcript.module.css";

type Group = {
  key: string;
  day: string;
  startsDay: boolean;
  messages: SupervisedMessage[];
};

const groupGapMs = 8 * 60_000;

function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Consecutive text from one author, one day, no gap over eight minutes. Order is
 * the server's; grouping only decides where an author line is drawn, and every
 * group starts with one, so who said what is never ambiguous.
 */
function groupMessages(messages: SupervisedMessage[]): Group[] {
  const groups: Group[] = [];
  let previousDay: string | null = null;
  for (const message of messages) {
    const day = localDay(message.createdAt);
    const current = groups[groups.length - 1];
    const previous = current?.messages[current.messages.length - 1];
    if (
      current &&
      previous &&
      current.day === day &&
      previous.author.profileId === message.author.profileId &&
      previous.messageType === "text" &&
      message.messageType === "text" &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <= groupGapMs
    ) {
      current.messages.push(message);
      continue;
    }
    groups.push({ key: message.messageId, day, startsDay: day !== previousDay, messages: [message] });
    previousDay = day;
  }
  return groups;
}

/** Microseconds since the epoch: Postgres keeps them, Date.parse stops at ms. */
function keysetTime(iso: string): number {
  const micros = /\.\d{3}(\d{1,3})/.exec(iso)?.[1] ?? "";
  return Date.parse(iso) * 1000 + Number(micros.padEnd(3, "0"));
}

/** Keyset order: (created_at, id), the same order the RPCs page by. */
function isBefore(a: SupervisedMessage, b: SupervisedMessage): boolean {
  const at = keysetTime(a.createdAt);
  const bt = keysetTime(b.createdAt);
  return at !== bt ? at < bt : a.messageId < b.messageId;
}

/**
 * Merges a fresh latest page into what is already loaded. The fresh page wins
 * for everything it covers (deletions, reaction counts, new rows); older rows
 * loaded earlier are kept, and so is their Load older cursor. When the fresh
 * page no longer overlaps what was loaded (more new rows than one page), the
 * old rows would sit behind an invisible gap, so the fresh page replaces them.
 */
export function reconcileLatest(
  current: SupervisedMessage[],
  currentCursor: SupervisedMessageCursor | null,
  fresh: SupervisedTranscriptPage,
): { messages: SupervisedMessage[]; cursor: SupervisedMessageCursor | null } {
  const freshCursor = fresh.hasMore ? fresh.nextCursor : null;
  const first = fresh.messages[0];
  const freshIds = new Set(fresh.messages.map((message) => message.messageId));
  if (!first || !fresh.hasMore || !current.some((message) => freshIds.has(message.messageId))) {
    return { messages: fresh.messages, cursor: freshCursor };
  }
  const older = current.filter((message) => isBefore(message, first));
  return {
    messages: [...older, ...fresh.messages],
    cursor: older.length > 0 ? currentCursor : freshCursor,
  };
}

function authorName(name: string | null): string {
  return name?.trim() || "Unnamed member";
}

function Timestamp({ iso }: { iso: string }) {
  return (
    <time
      className={styles.time}
      dateTime={iso}
      title={new Date(iso).toLocaleString()}
      suppressHydrationWarning
    >
      {formatTeamMessageTime(iso)}
    </time>
  );
}

/**
 * The supervisory transcript: one neutral column, author named at every group,
 * nobody drawn as "me". Everything rendered is a field of the supervisory DTO —
 * reply and forward context are display-only (no jump, no extra read), reactions
 * are counts, deleted and voice rows show the database's own placeholder text.
 *
 * Older history loads only on an explicit click: one click, one history action,
 * one PAGE audit. "Refresh latest" is the only other read: one click, one
 * detail action, one OPEN audit, merged by `reconcileLatest`. Nothing here
 * polls, refreshes on its own, marks read or writes. Only one of the two reads
 * runs at a time, so they cannot interleave their merges.
 */
export function SupervisedTranscript({
  initial,
  checkedAt,
  hidden = false,
  onLostAccess,
}: {
  initial: SupervisedTranscriptPage;
  /** When the detail read that produced `initial` completed. */
  checkedAt: string;
  /** Kept mounted while a search context window is shown, so nothing is refetched. */
  hidden?: boolean;
  /** A refresh found the conversation unavailable or the view forbidden. */
  onLostAccess: (code: ClientSafeError["code"]) => void;
}) {
  const [messages, setMessages] = useState(initial.messages);
  const [cursor, setCursor] = useState(initial.hasMore ? initial.nextCursor : null);
  const [busy, setBusy] = useState<"older" | "refresh" | null>(null);
  const [olderFailed, setOlderFailed] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [lastChecked, setLastChecked] = useState(checkedAt);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ element: Element; top: number } | null>(null);
  const toLatestRef = useRef(false);

  // A response that lands after this transcript closed (switch, Back) must not
  // reach the workspace, which by then shows something else.
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Open at the latest message. Desktop scrolls the panel; mobile, where the
  // page is the one scroll region, brings the end into view.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && scroller.scrollHeight > scroller.clientHeight) {
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      endRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, []);

  // After older rows are prepended, keep the previously first message where it
  // was; after "Refresh latest", show the latest.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (toLatestRef.current) {
      toLatestRef.current = false;
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        endRef.current?.scrollIntoView?.({ block: "nearest" });
      }
      return;
    }
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += delta;
    else window.scrollBy(0, delta);
  }, [messages]);

  async function loadOlder() {
    if (!cursor || busyRef.current) return;
    busyRef.current = true;
    setBusy("older");
    setOlderFailed(false);

    const result = await listSupervisedMessagesBeforeAction({
      conversationId: initial.conversationId,
      ...cursor,
    });

    busyRef.current = false;
    setBusy(null);
    if (!result.ok) {
      setOlderFailed(true);
      return;
    }
    const first = scrollRef.current?.querySelector("[data-message-id]");
    if (first) anchorRef.current = { element: first, top: first.getBoundingClientRect().top };
    setMessages((current) => [...result.data.messages, ...current]);
    setCursor(result.data.hasMore ? result.data.nextCursor : null);
  }

  async function refreshLatest() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("refresh");
    setRefreshFailed(false);

    const result = await getSupervisedConversationAction({ conversationId: initial.conversationId });

    busyRef.current = false;
    if (!aliveRef.current) return;
    setBusy(null);
    if (!result.ok) {
      // Access or eligibility changed: stop presenting privileged content as current.
      if (result.error.code === "NOT_FOUND" || result.error.code === "PERMISSION_DENIED") {
        onLostAccess(result.error.code);
      } else {
        setRefreshFailed(true);
      }
      return;
    }
    const next = reconcileLatest(messages, cursor, result.data);
    toLatestRef.current = true;
    setMessages(next.messages);
    setCursor(next.cursor);
    setLastChecked(new Date().toISOString());
  }

  return (
    <>
      <div className={styles.scroll} ref={scrollRef} hidden={hidden} data-transcript>
        {cursor ? (
          <div className={styles.older}>
            <button
              type="button"
              className="button-secondary"
              onClick={(event) => {
                // A double-tap tail (e.g. on Return, which reveals this button) is not a second decision.
                if (event.detail > 1) return;
                void loadOlder();
              }}
              disabled={busy !== null}
              aria-busy={busy === "older"}
            >
              {busy === "older" ? "Loading…" : "Load older messages"}
            </button>
            {olderFailed ? (
              <p className={styles.olderError} role="alert">
                Older messages could not be loaded.
              </p>
            ) : null}
          </div>
        ) : null}

        {messages.length === 0 ? (
          <p className={styles.notice}>No messages in this conversation.</p>
        ) : (
          <MessageGroups messages={messages} />
        )}
        <div ref={endRef} />
      </div>
      <div className={styles.freshness} hidden={hidden}>
        <p>
          Last checked{" "}
          <time
            dateTime={lastChecked}
            title={new Date(lastChecked).toLocaleString()}
            suppressHydrationWarning
          >
            {formatTeamMessageTime(lastChecked)}
          </time>
        </p>
        {refreshFailed ? (
          <p className={styles.freshnessError} role="alert">
            Couldn&apos;t refresh. Try again.
          </p>
        ) : null}
        <button
          type="button"
          className={styles.refresh}
          disabled={busy !== null}
          aria-busy={busy === "refresh"}
          onClick={(event) => {
            if (event.detail > 1) return;
            void refreshLatest();
          }}
        >
          <RotateCw aria-hidden="true" />
          {busy === "refresh" ? "Refreshing…" : "Refresh latest"}
        </button>
      </div>
    </>
  );
}

/**
 * The bounded window the search-result jump returned: the target and its
 * neighbours, in the transcript's own rendering, with the target marked in text
 * as well as tint. Nothing here loads more; the edges only say there is more.
 */
export function SupervisedContextWindow({
  messages,
  targetId,
  hasMoreBefore,
  hasMoreAfter,
}: {
  messages: SupervisedMessage[];
  targetId: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Bring the target to the middle of whichever region scrolls. Desktop moves
  // only this panel (scrollIntoView would also shift the shell card); stacked,
  // the page scrolls, and a tall target starts below the sticky header instead.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const target = root?.querySelector(`[data-message-id="${targetId}"]`);
    if (!root || !target) return;
    const t = target.getBoundingClientRect();
    if (root.scrollHeight > root.clientHeight) {
      const r = root.getBoundingClientRect();
      root.scrollTop += t.top + t.height / 2 - (r.top + r.height / 2);
    } else {
      target.scrollIntoView?.({ block: t.height > window.innerHeight / 2 ? "start" : "center" });
    }
  }, [targetId]);

  return (
    <div className={styles.scroll} ref={rootRef}>
      {hasMoreBefore ? <p className={styles.windowEdge}>Earlier messages not shown</p> : null}
      <MessageGroups messages={messages} targetId={targetId} />
      {hasMoreAfter ? <p className={styles.windowEdge}>Later messages not shown</p> : null}
    </div>
  );
}

function MessageGroups({ messages, targetId }: { messages: SupervisedMessage[]; targetId?: string }) {
  return (
    <ol className={styles.groups} aria-label="Messages">
      {groupMessages(messages).map((group) => (
        <li key={group.key}>
          {group.startsDay ? (
            <p className={styles.day}>
              <span suppressHydrationWarning>{formatTeamDayHeading(group.day)}</span>
            </p>
          ) : null}
          <MessageGroup messages={group.messages} targetId={targetId} />
        </li>
      ))}
    </ol>
  );
}

function MatchLabel() {
  return <span className={styles.matchLabel}>Matched message</span>;
}

function MessageGroup({ messages, targetId }: { messages: SupervisedMessage[]; targetId?: string }) {
  const first = messages[0]!;
  const name = authorName(first.author.displayName);

  if (first.messageType === "task_activity" || first.messageType === "governance_activity") {
    const Icon = first.messageType === "task_activity" ? CheckCircle2 : Settings;
    const target = first.messageId === targetId;
    return (
      <div
        className={`${styles.activity} ${target ? styles.target : ""}`}
        data-message-id={first.messageId}
        aria-current={target ? "true" : undefined}
      >
        <Icon aria-hidden="true" />
        <span className={styles.activityText}>
          <span className={styles.activityAuthor}>{name}</span>
          {first.messageType === "task_activity" ? " · Task update: " : " · "}
          {first.body}
        </span>
        <Timestamp iso={first.createdAt} />
      </div>
    );
  }

  return (
    <div className={styles.group}>
      <TeamAvatar
        name={name}
        initials={teamInitials(first.author.displayName)}
        avatarUrl={first.author.avatarUrl?.trim() || null}
        small
      />
      <div className={styles.groupBody}>
        <p className={styles.groupHeader}>
          <span className={styles.author}>{name}</span>
          {first.author.archived ? <span className={styles.archived}>Archived</span> : null}
          <Timestamp iso={first.createdAt} />
        </p>
        {messages.map((message) => (
          <MessageBody key={message.messageId} message={message} target={message.messageId === targetId} />
        ))}
      </div>
    </div>
  );
}

function MessageBody({ message, target }: { message: SupervisedMessage; target: boolean }) {
  const className = `${styles.message} ${target ? styles.target : ""}`;
  const current = target ? "true" : undefined;
  if (message.deletion) {
    return (
      <div className={className} data-message-id={message.messageId} aria-current={current}>
        {target ? <MatchLabel /> : null}
        <p className={styles.deleted}>{message.body}</p>
      </div>
    );
  }

  return (
    <div className={className} data-message-id={message.messageId} aria-current={current}>
      {target ? <MatchLabel /> : null}
      {message.forwarded ? (
        <p className={styles.forwarded}>
          <Forward aria-hidden="true" />
          Forwarded{message.forwardedFromAuthorName ? ` from ${message.forwardedFromAuthorName}` : ""}
        </p>
      ) : null}
      {message.reply ? (
        <blockquote className={styles.reply}>
          <span className={styles.replyAuthor}>
            Replying to {authorName(message.reply.authorName)}
          </span>
          {message.reply.body ? (
            <span
              className={message.reply.deletedForEveryone ? styles.replyDeleted : styles.replyText}
            >
              {message.reply.body}
            </span>
          ) : null}
        </blockquote>
      ) : null}
      {message.messageType === "voice" ? (
        <p className={styles.voice}>
          <Mic aria-hidden="true" />
          <span>
            {message.body}
            {message.supervisoryNotice ? (
              <span className={styles.voiceNotice}>{message.supervisoryNotice}</span>
            ) : null}
          </span>
        </p>
      ) : (
        <TeamFormattedMessage body={message.body} />
      )}
      {message.reactions.length > 0 ? (
        <ul className={styles.reactions} aria-label="Reactions">
          {message.reactions.map((reaction) => (
            <li key={reaction.reactionCode} className={styles.reaction}>
              <span aria-hidden="true">
                {teamReactionEmoji[reaction.reactionCode as TeamReactionCode] ?? reaction.reactionCode}
              </span>{" "}
              <span className={styles.srOnly}>{reaction.reactionCode}: </span>
              {reaction.count}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
