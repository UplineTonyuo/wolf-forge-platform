"use client";

import type { TeamSupervisionActionResult } from "../../app/actions/team-supervision";
import type {
  SupervisedConversationPage,
  SupervisedConversationSummary,
  SupervisedEmployee,
  SupervisedParticipant,
} from "../../domain/team-supervision/projections";
import { formatTeamRelativeTime, teamInitials } from "../../domain/team/projections";
import { TeamAvatar } from "../team/team-avatar";
import { DataError, EmptyState } from "../ui/list-states";
import styles from "./supervised-conversation-list.module.css";

/**
 * All Conversations rows. Metadata only: who, and when a conversation last had
 * activity. It deliberately renders no preview, unread state, presence or
 * typing, and it is not the participant Team view — nothing here can write,
 * mark read or announce the viewer. Rows only report a selection; they never
 * read a transcript.
 */

/** The whole-workspace states: refused, failed, or nothing to supervise. */
export function SupervisedListState({
  initial,
}: {
  initial: TeamSupervisionActionResult<SupervisedConversationPage>;
}) {
  if (!initial.ok) {
    return initial.error.code === "PERMISSION_DENIED" ? (
      <EmptyState title="You don't have access to this view." />
    ) : (
      <DataError message="Conversations could not be loaded." />
    );
  }
  return (
    <EmptyState
      title="No conversations yet"
      body="Team direct conversations will appear here when available."
    />
  );
}

export function SupervisedEmployeeList({
  employees,
  selectedId,
  onSelect,
}: {
  employees: SupervisedEmployee[];
  selectedId: string | null;
  onSelect: (profileId: string) => void;
}) {
  return (
    <ul className={styles.list} aria-label="Employees">
      {employees.map(({ participant, partnerCount }) => (
        <li key={participant.profileId}>
          <button
            type="button"
            className={styles.row}
            data-employee-id={participant.profileId}
            aria-current={selectedId === participant.profileId ? "true" : undefined}
            onClick={() => onSelect(participant.profileId)}
          >
            <Avatar participant={participant} />
            <span className={styles.text}>
              <Name participant={participant} />
              <span className={styles.meta}>{peopleLabel(partnerCount)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SupervisedPartnerList({
  employee,
  selectedId,
  onSelect,
}: {
  employee: SupervisedEmployee;
  selectedId: string | null;
  onSelect: (conversation: SupervisedConversationSummary) => void;
}) {
  return (
    <ul className={styles.list} aria-label={`Conversations with ${participantName(employee.participant)}`}>
      {employee.conversations.map(({ conversation, partner }) => (
        <li key={conversation.conversationId}>
          <button
            type="button"
            className={styles.row}
            data-conversation-id={conversation.conversationId}
            aria-current={selectedId === conversation.conversationId ? "true" : undefined}
            onClick={(event) => {
              // The tail of a double tap (e.g. on mobile Back, which reveals
              // this row under the finger) is not a deliberate open. Keyboard
              // activation reports 0 and still opens.
              if (event.detail > 1) return;
              onSelect(conversation);
            }}
          >
            <Avatar participant={partner} />
            <span className={styles.text}>
              <Name participant={partner} />
              <LastActivity iso={conversation.lastMessageAt} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function peopleLabel(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

export function participantName(participant: SupervisedParticipant): string {
  return participant.displayName?.trim() || "Unnamed member";
}

export function Avatar({ participant, small = true }: { participant: SupervisedParticipant; small?: boolean }) {
  return (
    <TeamAvatar
      name={participantName(participant)}
      initials={teamInitials(participant.displayName)}
      avatarUrl={participant.avatarUrl?.trim() || null}
      small={small}
    />
  );
}

function Name({ participant }: { participant: SupervisedParticipant }) {
  return (
    <span className={styles.person}>
      <span className={styles.name}>{participantName(participant)}</span>
      {participant.archived ? <span className={styles.archived}>Archived</span> : null}
    </span>
  );
}

function LastActivity({ iso }: { iso: string | null }) {
  if (!iso) return <span className={styles.meta}>No messages yet</span>;
  return (
    <time className={styles.meta} dateTime={iso} title={new Date(iso).toLocaleString()} suppressHydrationWarning>
      Last activity · {formatTeamRelativeTime(iso)}
    </time>
  );
}
