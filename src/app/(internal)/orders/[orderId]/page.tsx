import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectBackToOrders } from "../../../../components/projects/project-back-to-orders";
import { ProjectDetailActions } from "../../../../components/projects/project-detail-actions";
import styles from "../../../../components/projects/project-detail.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { PageFrame } from "../../../../components/ui/page-frame";
import {
  composeProjectTaskViews,
  projectNeedsAttention,
  projectPriorityLabels,
  projectStatusLabels,
} from "../../../../domain/orders/projections";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatDate, formatDateTime } from "../../../../lib/format";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const context = await getInternalContext();

  try {
    const [project, tasks, activity, people] = await Promise.all([
      context.services.orders.getWithRelations(orderId),
      context.services.tasks.listForOrder(orderId),
      context.services.activity.listTimeline("order", orderId),
      context.services.catalog.listAssignees(),
    ]);

    const nameById = new Map(people.map((person) => [person.id, person.displayName]));
    const { views: taskViews, counts: taskCounts } = composeProjectTaskViews(tasks);
    const needsAttention = projectNeedsAttention(project.status, taskCounts);

    return (
      <PageFrame
        title={project.title}
        description={`Project #${project.order_number} ${String.fromCharCode(183)} ${project.companies?.name ?? "Unavailable client"}`}

      >
        <div className={styles.detailToolbar}>
          <ProjectBackToOrders />

          <ProjectDetailActions
            orderId={project.id}
            status={project.status}
            assigneeId={project.assigned_to_profile_id}
            people={people.map((person) => ({
              id: person.id,
              name: person.displayName,
            }))}
            capabilities={context.user.projects}
          />
        </div>


        {needsAttention ? (
          <p className={styles.attention}>
            <BellRing size={14} aria-hidden="true" />
            This project needs attention.
          </p>
        ) : null}

        <dl className={styles.summary}>
          <div className={styles.summaryItem}>
            <dt>Client</dt>
            <dd>
              {project.companies ? (
                <Link href={`/clients/${project.companies.id}`}>{project.companies.name}</Link>
              ) : (
                <span className={styles.muted}>Unavailable</span>
              )}
            </dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Service</dt>
            <dd>
              {project.services ? (
                <Link href={`/services/${project.services.id}`}>{project.services.name}</Link>
              ) : (
                <span className={styles.muted}>Unavailable</span>
              )}
            </dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Status</dt>
            <dd>{projectStatusLabels[project.status]}</dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Priority</dt>
            <dd>{projectPriorityLabels[project.priority]}</dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Assigned to</dt>
            <dd>
              {project.profiles ? (
                project.profiles.display_name ?? "Unnamed teammate"
              ) : (
                <span className={styles.muted}>Unassigned</span>
              )}
            </dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Created</dt>
            <dd>{formatDate(project.created_at)}</dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Started</dt>
            <dd>
              {project.started_at ? formatDate(project.started_at) : <span className={styles.muted}>{"\u2014"}</span>}
            </dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Due</dt>
            <dd>{project.due_at ? formatDate(project.due_at) : <span className={styles.muted}>{"\u2014"}</span>}</dd>
          </div>

          <div className={styles.summaryItem}>
            <dt>Completed</dt>
            <dd>
              {project.completed_at ? (
                formatDate(project.completed_at)
              ) : (
                <span className={styles.muted}>{"\u2014"}</span>
              )}
            </dd>
          </div>
        </dl>

        <div className={styles.panels}>
          <section className={styles.panel} aria-labelledby="project-tasks-heading">
            <div className={styles.panelHeading}>
              <h2 id="project-tasks-heading">Tasks</h2>
              <span>
                {taskCounts.open} open / {taskCounts.total} total
              </span>
            </div>

            <div className={styles.panelBody}>
              {taskViews.length === 0 ? (
                <p className={styles.panelEmpty}>This project has no tasks yet.</p>
              ) : (
                taskViews.map((task) => (
                  <div className={styles.taskRow} key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <div className={styles.taskMeta}>
                        <span>
                          {task.assigneeId
                            ? nameById.get(task.assigneeId) ?? "Unnamed teammate"
                            : "Unassigned"}
                        </span>
                        {task.dueAt ? (
                          <span className={task.overdue ? styles.overdue : undefined}>
                            Due {formatDate(task.dueAt)}
                            {task.overdue ? " Ã¯Â¿Â½\u00B7 overdue" : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <span
                      className={
                        task.status === "complete"
                          ? `${styles.taskStatus} ${styles.taskStatusComplete}`
                          : styles.taskStatus
                      }
                    >
                      {task.statusLabel}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="project-activity-heading">
            <div className={styles.panelHeading}>
              <h2 id="project-activity-heading">Activity</h2>
              <span>{activity.length}</span>
            </div>

            <div className={styles.panelBody}>
              {activity.length === 0 ? (
                <p className={styles.panelEmpty}>No activity has been recorded yet.</p>
              ) : (
                activity.map((event) => (
                  <div className={styles.activityRow} key={event.id}>
                    <span>{event.summary}</span>
                    <span className={styles.activityMeta}>
                      {(event.actor_profile_id ? nameById.get(event.actor_profile_id) : null) ?? "Wolf Forge"}
                      {" "}{String.fromCharCode(183)}{" "}{formatDateTime(event.created_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {project.notes ? (
          <section className={`${styles.panel} ${styles.notesPanel}`} aria-labelledby="project-notes-heading">
            <div className={styles.panelHeading}>
              <h2 id="project-notes-heading">Internal notes</h2>
              <span>Staff only</span>
            </div>
            <p className={styles.notes}>{project.notes}</p>
          </section>
        ) : null}
      </PageFrame>
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "NOT_FOUND") notFound();

    return (
      <PageFrame title="Project">
        <DataError message={safe.message} />
      </PageFrame>
    );
  }
}
