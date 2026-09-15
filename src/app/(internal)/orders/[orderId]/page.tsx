import { Fragment } from "react";
import { InternalNotesModal } from "../../../../components/tickets/internal-notes-modal";
import { OrderConversation } from "../../../../components/tickets/order-conversation";
import { DataError } from "../../../../components/ui/list-states";
import { composeProjectTaskViews } from "../../../../domain/orders/projections";
import { toTeamConversationViews } from "../../../../domain/team/projections";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatDate } from "../../../../lib/format";
import { getInternalContext } from "../../../../lib/supabase/next-server";
import styles from "../../../../components/projects/project-detail.module.css";

export default async function OrderDetailsPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const context = await getInternalContext();

  try {
    const [order, tasks, people, conversation, teamConversations] = await Promise.all([
      context.services.orders.get(orderId),
      context.services.tasks.listForOrder(orderId),
      context.services.catalog.listAssignees(),
      context.services.tickets.getForOrder(orderId),
      context.user.teamMessaging.use ? context.services.team.listConversations() : Promise.resolve([]),
    ]);

    const canViewForms = context.user.forms.submissionsView;
    const formSubmissions = canViewForms
      ? await context.services.forms.listSubmissions(undefined, orderId)
      : [];
    const latestSubmission = formSubmissions[0] ?? null;
    const submissionDetail = latestSubmission
      ? await context.services.forms.getSubmission(latestSubmission.id)
      : null;

    const nameById = new Map(people.map((person) => [person.id, person.displayName]));
    const { views: taskViews, counts: taskCounts } = composeProjectTaskViews(tasks);
    const conversationTicket = conversation?.ticket ?? null;
    const repliesDisabled = conversationTicket
      ? conversationTicket.status === "closed" || Boolean(conversationTicket.archived_at)
      : false;
    const conversationMessages = conversation?.messages ?? [];
    const internalNotes = conversationMessages.filter((message) => message.message_kind === "internal_note");

    return (
      <>
        {order.notes ? (
          <div className={styles.noteCallout}>
            <h2>Team note</h2>
            <p>{order.notes}</p>
          </div>
        ) : null}

        <section className={styles.fieldsCard} aria-labelledby="order-fields-heading">
          <h2 id="order-fields-heading" className={styles.sectionHeading}>
            Form response
          </h2>

          {submissionDetail ? (
            <dl className={styles.fieldGrid}>
              {submissionDetail.values.map((field) => (
                <Fragment key={field.stable_field_key}>
                  <dt>{field.label}</dt>
                  <dd>
                    {typeof field.value === "string" || typeof field.value === "number"
                      ? String(field.value)
                      : field.value == null
                        ? <span className={styles.muted}>Not answered</span>
                        : JSON.stringify(field.value)}
                  </dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <p className={styles.panelEmpty}>
              {canViewForms
                ? "No form has been submitted for this Order yet."
                : "You do not have permission to view Form submissions."}
            </p>
          )}
        </section>

        <section aria-labelledby="order-conversation-heading">
          <h2 id="order-conversation-heading" className="sr-only">
            Conversation
          </h2>

          <OrderConversation
            orderId={orderId}
            viewerProfileId={context.user.id}
            messages={conversationMessages}
            heading={`Project #${order.order_number}`}
            destinations={toTeamConversationViews(teamConversations)}
            canReply={context.user.tickets.reply}
            repliesDisabled={repliesDisabled}
            headerActions={
              context.user.tickets.internalNotes ? (
                <InternalNotesModal
                  target={{ kind: "order", orderId }}
                  notes={internalNotes}
                  disabled={Boolean(conversationTicket?.archived_at)}
                />
              ) : null
            }
          />
        </section>

        <section className={styles.secondary} aria-labelledby="order-secondary-heading">
          <h2 id="order-secondary-heading" className={styles.secondaryHeading}>
            Tasks
          </h2>

          <div className={styles.panels}>
            <section className={styles.panel} aria-labelledby="project-tasks-heading">
              <div className={styles.panelHeading}>
                <h3 id="project-tasks-heading">Tasks</h3>
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
                              {task.overdue ? ` ${String.fromCharCode(183)} overdue` : ""}
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
          </div>
        </section>
      </>
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    return <DataError message={safe.message} />;
  }
}
