"use client";

import {
  AlertCircle,
  ArrowLeft,
  ListChecks,
  Loader2,
  Users,
} from "lucide-react";
import {
  groupTeamTasksByStatus,
  sortTeamTasks,
  type TeamTaskListView,
} from "../../domain/team/projections";
import {
  teamTaskStatusLabels,
  type TeamTaskStatus,
} from "../../domain/team/schema";
import { TeamTaskCard } from "./team-task-card";
import styles from "./team-messages.module.css";

export type TeamTaskScope = "mine" | "team";

/**
 * My Tasks and Team Tasks.
 *
 * The Team Tasks segment is only offered to a team_tasks.manage holder, and
 * even then it is a request rather than a grant: app_list_my_team_tasks
 * re-checks the capability and silently returns only the actor's own
 * assignments without it. Its scope is also narrower than its name suggests,
 * deliberately — it covers conversations the viewer is party to, not everybody
 * else's private threads.
 */
export function TeamTasksPanel({
  tasks,
  scope,
  onScopeChange,
  canManageTasks,
  actorProfileId,
  loading,
  error,
  onRetry,
  onBack,
  onOpenConversation,
  onTaskStatusChange,
  busyTaskId,
}: {
  tasks: TeamTaskListView[];
  scope: TeamTaskScope;
  onScopeChange: (scope: TeamTaskScope) => void;
  canManageTasks: boolean;
  actorProfileId: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
  onOpenConversation: (
    conversationId: string,
    sourceMessageId: string | null,
  ) => void;
  onTaskStatusChange: (taskId: string, status: TeamTaskStatus) => void;
  busyTaskId: string | null;
}) {
  const board = groupTeamTasksByStatus(sortTeamTasks(tasks));
  const isEmpty = !loading && !error && tasks.length === 0;

  return (
    <section className={styles.tasksPane} aria-label="Team tasks">
      <header className={styles.paneHeader}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.backButton}`}
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft aria-hidden="true" />
        </button>

        <div className={styles.paneHeaderText}>
          <strong>{scope === "team" ? "Team Tasks" : "My Tasks"}</strong>
          <span>
            {scope === "team"
              ? "Every task in the conversations you are part of"
              : "Work assigned to you across your conversations"}
          </span>
        </div>

        <div className={styles.paneHeaderActions}>
          {loading ? (
            <Loader2 aria-label="Refreshing" className={styles.spin} />
          ) : null}

          {canManageTasks ? (
            <div
              className={styles.segmented}
              role="tablist"
              aria-label="Task scope"
            >
              <button
                type="button"
                role="tab"
                aria-selected={scope === "mine"}
                className={[
                  styles.segment,
                  scope === "mine" ? styles.segmentActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onScopeChange("mine")}
              >
                <ListChecks aria-hidden="true" />
                Mine
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scope === "team"}
                className={[
                  styles.segment,
                  scope === "team" ? styles.segmentActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onScopeChange("team")}
              >
                <Users aria-hidden="true" />
                Team
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className={styles.tasksScroll}>
        {error ? (
          <div className={`${styles.stateBlock} ${styles.stateError}`}>
            <span className={styles.stateIcon}>
              <AlertCircle aria-hidden="true" />
            </span>
            <strong>Tasks could not be loaded</strong>
            <p>{error}</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onRetry}
            >
              Try again
            </button>
          </div>
        ) : null}

        {loading && tasks.length === 0 && !error ? (
          <div className={styles.skeletonList} aria-busy="true">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : null}

        {isEmpty ? (
          <div className={styles.stateBlock}>
            <span className={styles.stateIcon}>
              <ListChecks aria-hidden="true" />
            </span>
            <strong>
              {scope === "team"
                ? "No team tasks yet"
                : "Nothing assigned to you"}
            </strong>
            <p>
              {canManageTasks
                ? "Create one from a message, or from the Task button in any conversation."
                : "Tasks assigned to you by management will appear here."}
            </p>
          </div>
        ) : null}

        {board.map((column) =>
          column.tasks.length === 0 ? null : (
            <div key={column.status} className={styles.taskColumn}>
              <div className={styles.taskColumnHead}>
                <strong>{teamTaskStatusLabels[column.status]}</strong>
                <span className={styles.tabCount}>{column.tasks.length}</span>
                <span className={styles.taskColumnRule} />
              </div>

              <div className={styles.taskGrid}>
                {column.tasks.map((task) => (
                  <TeamTaskCard
                    key={task.id}
                    task={task}
                    actorProfileId={actorProfileId}
                    canManageTasks={canManageTasks}
                    busy={busyTaskId === task.id}
                    contextLabel={
                      task.otherMemberName && !task.isMine
                        ? `for ${task.assignedToName}`
                        : task.otherMemberName
                          ? `with ${task.otherMemberName}`
                          : null
                    }
                    onStatusChange={(status) =>
                      onTaskStatusChange(task.id, status)
                    }
                    onNavigateToSource={() =>
                      onOpenConversation(
                        task.conversationId,
                        task.sourceMessageId,
                      )
                    }
                    onOpenConversation={() =>
                      onOpenConversation(task.conversationId, null)
                    }
                  />
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
