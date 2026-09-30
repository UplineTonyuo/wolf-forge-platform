"use client";

import { useRef, useState } from "react";
import { listSupervisedConversationsAction, type TeamSupervisionActionResult } from "../../app/actions/team-supervision";
import type {
  SupervisedConversationPage,
  SupervisedConversationSummary,
  SupervisedParticipant,
} from "../../domain/team-supervision/projections";
import { formatTeamRelativeTime, teamInitials } from "../../domain/team/projections";
import { TeamAvatar } from "../team/team-avatar";
import { DataError, EmptyState } from "../ui/list-states";
import styles from "./supervised-conversation-list.module.css";

/**
 * The All Conversations list. Metadata only: the two participants and when the
 * conversation last had activity. It deliberately renders no preview, unread
 * state, presence or typing, and it is not the participant Team view — nothing
 * here can write, mark read or announce the viewer.
 *
 * A row is a button only when the workspace passes `onSelect`; the list itself
 * never reads a transcript.
 */
export function SupervisedConversationList({
  initial,
  selectedId = null,
  onSelect,
}: {
  initial: TeamSupervisionActionResult<SupervisedConversationPage>;
  selectedId?: string | null;
  onSelect?: (conversation: SupervisedConversationSummary) => void;
}) {
  const [conversations, setConversations] = useState(initial.ok ? initial.data.conversations : []);
  const [cursor, setCursor] = useState(initial.ok ? initial.data.nextCursor : null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const loadingRef = useRef(false);

  if (!initial.ok) {
    return initial.error.code === "PERMISSION_DENIED" ? (
      <EmptyState title="You don't have access to this view." />
    ) : (
      <DataError message="Conversations could not be loaded." />
    );
  }

  if (conversations.length === 0) {
    return (
      <EmptyState
        title="No conversations yet"
        body="Team direct conversations will appear here when available."
      />
    );
  }

  // One keyset page at a time. No retry loop: a failure waits for another click.
  async function loadMore() {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);

    const result = await listSupervisedConversationsAction(cursor);

    loadingRef.current = false;
    setLoadingMore(false);
    if (!result.ok) {
      setLoadMoreFailed(true);
      return;
    }
    setConversations((current) => [...current, ...result.data.conversations]);
    setCursor(result.data.nextCursor);
  }

  return (
    <div className={styles.list}>
      <ul aria-label="Team conversations">
        {conversations.map((conversation) => {
          const content = (
            <>
              <span className={styles.avatars}>
                {conversation.participants.map((participant) => (
                  <TeamAvatar
                    key={participant.profileId}
                    name={participantName(participant)}
                    initials={teamInitials(participant.displayName)}
                    avatarUrl={participant.avatarUrl?.trim() || null}
                    small
                  />
                ))}
              </span>
              <span className={styles.pair}>
                <Participant participant={conversation.participants[0]} />
                {/* The arrow wraps with the second name, never dangling at a line end. */}
                <span className={styles.person}>
                  <span className={styles.separator} aria-hidden="true">
                    ↔
                  </span>
                  {" "}<span className={styles.srOnly}>and</span>{" "}
                  <Participant participant={conversation.participants[1]} />
                </span>
              </span>
              <LastActivity iso={conversation.lastMessageAt} />
            </>
          );
          return (
            <li key={conversation.conversationId}>
              {onSelect ? (
                <button
                  type="button"
                  className={`${styles.row} ${styles.rowButton}`}
                  data-conversation-id={conversation.conversationId}
                  aria-current={selectedId === conversation.conversationId ? "true" : undefined}
                  onClick={() => onSelect(conversation)}
                >
                  {content}
                </button>
              ) : (
                <div className={styles.row}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>

      {cursor ? (
        <div className={styles.more}>
          <button
            type="button"
            className="button-secondary"
            onClick={loadMore}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
          {loadMoreFailed ? (
            <p className={styles.moreError} role="alert">
              More conversations could not be loaded.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function participantName(participant: SupervisedParticipant): string {
  return participant.displayName?.trim() || "Unnamed member";
}

function Participant({ participant }: { participant: SupervisedParticipant }) {
  return (
    <span className={styles.person}>
      <span className={styles.name}>{participantName(participant)}</span>
      {participant.archived ? <span className={styles.archived}>Archived</span> : null}
    </span>
  );
}

function LastActivity({ iso }: { iso: string | null }) {
  if (!iso) return <span className={styles.activity}>No messages yet</span>;
  return (
    <time
      className={styles.activity}
      dateTime={iso}
      title={new Date(iso).toLocaleString()}
      suppressHydrationWarning
    >
      Last activity · {formatTeamRelativeTime(iso)}
    </time>
  );
}
