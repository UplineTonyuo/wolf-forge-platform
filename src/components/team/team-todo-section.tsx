"use client";

import { AlertCircle, ListChecks, Users } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  groupTeamTasksByStatus,
  sortTeamTasks,
  toTeamTaskListViews,
} from "../../domain/team/projections";
import {
  teamTaskStatusLabels,
  type TeamTaskListRow,
  type TeamTaskStatus,
} from "../../domain/team/schema";
import {
  listTeamTasksAction,
  updateTeamTaskStatusAction,
} from "../../app/actions/team-messages";
import { TeamTaskCard } from "./team-task-card";
import styles from "./team-messages.module.css";

/**
 * Team tasks assigned to the signed-in member, on the To Do page.
 *
 * THESE ARE NOT COPIES. The page renders the same `public.team_tasks` rows the
 * Messages drawer renders, read through the same `app_list_my_team_tasks` RPC,
 * and a status control here calls the same `app_update_team_task_status`. There
 * is one canonical task and one status column, so "keeping the two surfaces in
 * sync" is not a thing this code has to do — there is nothing to drift.
 *
 * Mirroring team tasks into `public.order_tasks` was the obvious alternative
 * and is wrong: an order task requires an `order_id` and belongs to client
 * project delivery, while a team task is conversation-scoped and has no order.
 * That route would have produced exactly the two drifting copies this design
 * exists to avoid.
 *
 * Seeded from the server render so the section is correct on first paint, then
 * re-read after a mutation to pick up whatever else changed (a completion
 * writes a conversation event and a notification too).
 */
export function TeamTodoSection({
  initialTasks,
  actorProfileId,
  canManageTasks,
}: {
  initialTasks: TeamTaskListRow[];
  actorProfileId: string;
  canManageTasks: boolean;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  /*
   * A fresh server render wins over whatever this component last fetched for
   * itself. Adjusted during render — React's documented answer to a changing
   * input — so the page never paints one frame of the previous payload first.
   */
  const [seededFrom, setSeededFrom] = useState(initialTasks);
  if (initialTasks !== seededFrom) {
    setSeededFrom(initialTasks);
    setTasks(initialTasks);
  }

  const changeStatus = useCallback(
    async (taskId: string, status: TeamTaskStatus) => {
      setBusyTaskId(taskId);
      setError(null);

      const result = await updateTeamTaskStatusAction({ taskId, status });
      if (!result.ok) {
        setBusyTaskId(null);
        setError(result.error);
        return;
      }

      const refreshed = await listTeamTasksAction(scope === "team");
      setBusyTaskId(null);
      if (refreshed.ok) setTasks(refreshed.data);
    },
    [scope],
  );

  const changeScope = useCallback(async (nextScope: "mine" | "team") => {
    setScope(nextScope);
    setError(null);
    const refreshed = await listTeamTasksAction(nextScope === "team");
    if (refreshed.ok) setTasks(refreshed.data);
    else setError(refreshed.error);
  }, []);

  /*
   * Jump to source reuses the drawer's own one-shot deep-link pattern
   * (?team-messages=<id>): the Inbox is globally mounted in the internal
   * shell, so updating this page's own query string is enough to open the
   * originating Team conversation from here -- no drawer instance to reach
   * into directly from a different page.
   */
  const openConversation = useCallback(
    (conversationId: string) => {
      router.push(`${pathname}?team-messages=${conversationId}`);
    },
    [pathname, router],
  );

  const views = toTeamTaskListViews(tasks, actorProfileId);
  const board = groupTeamTasksByStatus(sortTeamTasks(views));

  return (
    <section className="attention-section">
      <div className="section-heading">
        <h2>{scope === "team" ? "Team tasks" : "Assigned to me"}</h2>
        <span>{views.filter((task) => task.status !== "done").length}</span>
        {canManageTasks ? (
          <div className={styles.segmented} role="tablist" aria-label="Task scope">
            <button
              type="button"
              role="tab"
              aria-selected={scope === "mine"}
              className={[styles.segment, scope === "mine" ? styles.segmentActive : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => void changeScope("mine")}
            >
              <ListChecks aria-hidden="true" />
              Mine
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "team"}
              className={[styles.segment, scope === "team" ? styles.segmentActive : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => void changeScope("team")}
            >
              <Users aria-hidden="true" />
              Team
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className={styles.inlineError} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {views.length === 0 ? (
        <p className="compact-empty">
          {scope === "team"
            ? "No task exists in your conversations yet."
            : "No teammate has assigned you a task right now."}
        </p>
      ) : (
        <div className={styles.todoTaskBoard}>
          {board.map((column) => (
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
                    onStatusChange={(status) =>
                      void changeStatus(task.id, status)
                    }
                    onNavigateToSource={() => openConversation(task.conversationId)}
                    onOpenConversation={() => openConversation(task.conversationId)}
                    contextLabel={
                      task.conversationKind === "group"
                        ? `in ${task.conversationName ?? "a group"}`
                        : task.otherMemberName
                          ? `with ${task.otherMemberName}`
                          : null
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
