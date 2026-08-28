"use client";

import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock3,
  Flag,
  MessageSquare,
  Quote,
  User,
} from "lucide-react";
import {
  canMoveTeamTask,
  type TeamTaskView,
} from "../../domain/team/projections";
import {
  teamTaskPriorityLabels,
  teamTaskStatuses,
  teamTaskStatusLabels,
  type TeamTaskStatus,
} from "../../domain/team/schema";
import styles from "./team-messages.module.css";

const statusIcons: Record<TeamTaskStatus, typeof CircleDashed> = {
  todo: CircleDashed,
  in_progress: CircleDot,
  done: CheckCircle2,
};

const priorityClasses: Record<string, string> = {
  low: styles.taskPriorityLow!,
  normal: styles.taskPriorityNormal!,
  high: styles.taskPriorityHigh!,
  urgent: styles.taskPriorityUrgent!,
};

/**
 * A real team task, rendered as a card.
 *
 * The three status controls are always all three, so the card shows the whole
 * workflow rather than only the next step — moving something back from Done is
 * a normal thing to need. They are disabled, never hidden, when the viewer may
 * not move this task: a hidden control looks like a task with no status, while
 * a disabled one reads as "not yours to move", which is the truth.
 *
 * `canMoveTeamTask` mirrors app_update_team_task_status exactly. It is
 * presentation only — the database refuses the call regardless.
 */
export function TeamTaskCard({
  task,
  actorProfileId,
  canManageTasks,
  onStatusChange,
  onNavigateToSource,
  onOpenConversation,
  busy = false,
  contextLabel = null,
}: {
  task: TeamTaskView;
  actorProfileId: string;
  canManageTasks: boolean;
  onStatusChange: (status: TeamTaskStatus) => void;
  onNavigateToSource?: (messageId: string) => void;
  /**
   * Offered by the Tasks panel, where a card is read outside its thread. Inside
   * a conversation the viewer is already there, so it is omitted.
   */
  onOpenConversation?: () => void;
  busy?: boolean;
  /** "with Anthony Paghubasan" in the cross-conversation Tasks list. */
  contextLabel?: string | null;
}) {
  const canMove = canMoveTeamTask(task, actorProfileId, canManageTasks);

  return (
    <article
      className={[
        styles.taskCard,
        priorityClasses[task.priority] ?? styles.taskPriorityNormal,
        task.status === "done" ? styles.taskCardDone : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Task: ${task.title}`}
    >
      <div className={styles.taskTop}>
        <span className={styles.taskTitle}>{task.title}</span>
      </div>

      {task.description ? (
        <p className={styles.taskDescription}>{task.description}</p>
      ) : null}

      <div className={styles.taskMeta}>
        <span className={`${styles.chip} ${styles.chipPriority}`}>
          <Flag aria-hidden="true" />
          {teamTaskPriorityLabels[task.priority]}
        </span>

        <span
          className={`${styles.chip} ${task.isMine ? styles.chipMine : ""}`}
        >
          <User aria-hidden="true" />
          {task.isMine ? "You" : task.assignedToName}
        </span>

        {task.dueLabel ? (
          <span
            className={`${styles.chip} ${task.isOverdue ? styles.chipOverdue : ""}`}
          >
            <Clock3 aria-hidden="true" />
            {task.dueLabel}
          </span>
        ) : null}

        {contextLabel ? (
          <span className={styles.taskContext}>{contextLabel}</span>
        ) : null}
      </div>

      <div className={styles.taskActions}>
        {teamTaskStatuses.map((status) => {
          const Icon = statusIcons[status];
          const active = task.status === status;

          return (
            <button
              key={status}
              type="button"
              className={[
                styles.statusButton,
                active ? styles.statusButtonActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={active}
              disabled={busy || !canMove || active}
              title={
                canMove
                  ? `Move to ${teamTaskStatusLabels[status]}`
                  : "Only the assignee, the person who created this task, or management can move it"
              }
              onClick={() => onStatusChange(status)}
            >
              <Icon aria-hidden="true" />
              {teamTaskStatusLabels[status]}
            </button>
          );
        })}

        {task.sourceMessageId && onNavigateToSource ? (
          <button
            type="button"
            className={styles.sourceLink}
            onClick={() => onNavigateToSource(task.sourceMessageId!)}
            title="Jump to the message this task came from"
          >
            <Quote aria-hidden="true" />
            From message
          </button>
        ) : onOpenConversation ? (
          <button
            type="button"
            className={styles.sourceLink}
            onClick={onOpenConversation}
            title="Open the conversation this task belongs to"
          >
            <MessageSquare aria-hidden="true" />
            Open thread
          </button>
        ) : null}
      </div>
    </article>
  );
}
