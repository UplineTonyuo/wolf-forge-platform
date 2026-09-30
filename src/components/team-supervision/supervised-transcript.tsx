"use client";

import { CheckCircle2, Forward, Mic, Settings } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { listSupervisedMessagesBeforeAction } from "../../app/actions/team-supervision";
import type {
  SupervisedMessage,
  SupervisedTranscriptPage,
} from "../../domain/team-supervision/projections";
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
 * one PAGE audit. Nothing here polls, refreshes, marks read or writes.
 */
export function SupervisedTranscript({ initial }: { initial: SupervisedTranscriptPage }) {
  const [messages, setMessages] = useState(initial.messages);
  const [cursor, setCursor] = useState(initial.hasMore ? initial.nextCursor : null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const loadingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ element: Element; top: number } | null>(null);

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

  // After older rows are prepended, keep the previously first message where it was.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    const scroller = scrollRef.current;
    if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += delta;
    else window.scrollBy(0, delta);
  }, [messages]);

  async function loadOlder() {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    setOlderFailed(false);

    const result = await listSupervisedMessagesBeforeAction({
      conversationId: initial.conversationId,
      ...cursor,
    });

    loadingRef.current = false;
    setLoadingOlder(false);
    if (!result.ok) {
      setOlderFailed(true);
      return;
    }
    const first = scrollRef.current?.querySelector("[data-message-id]");
    if (first) anchorRef.current = { element: first, top: first.getBoundingClientRect().top };
    setMessages((current) => [...result.data.messages, ...current]);
    setCursor(result.data.hasMore ? result.data.nextCursor : null);
  }

  return (
    <div className={styles.scroll} ref={scrollRef}>
      {cursor ? (
        <div className={styles.older}>
          <button
            type="button"
            className="button-secondary"
            onClick={loadOlder}
            disabled={loadingOlder}
            aria-busy={loadingOlder}
          >
            {loadingOlder ? "Loading…" : "Load older messages"}
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
        <ol className={styles.groups} aria-label="Messages">
          {groupMessages(messages).map((group) => (
            <li key={group.key}>
              {group.startsDay ? (
                <p className={styles.day}>
                  <span suppressHydrationWarning>{formatTeamDayHeading(group.day)}</span>
                </p>
              ) : null}
              <MessageGroup messages={group.messages} />
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}

function MessageGroup({ messages }: { messages: SupervisedMessage[] }) {
  const first = messages[0]!;
  const name = authorName(first.author.displayName);

  if (first.messageType === "task_activity" || first.messageType === "governance_activity") {
    const Icon = first.messageType === "task_activity" ? CheckCircle2 : Settings;
    return (
      <div className={styles.activity} data-message-id={first.messageId}>
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
          <MessageBody key={message.messageId} message={message} />
        ))}
      </div>
    </div>
  );
}

function MessageBody({ message }: { message: SupervisedMessage }) {
  if (message.deletion) {
    return (
      <div className={styles.message} data-message-id={message.messageId}>
        <p className={styles.deleted}>{message.body}</p>
      </div>
    );
  }

  return (
    <div className={styles.message} data-message-id={message.messageId}>
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
