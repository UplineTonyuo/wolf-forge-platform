import { OrderSubmittedForms } from "../../../../components/projects/order-submitted-forms";
import { OrderTeamNote } from "../../../../components/projects/order-team-note";
import { ProjectTasks } from "../../../../components/projects/project-tasks";
import { InternalNotesModal } from "../../../../components/tickets/internal-notes-modal";
import { OrderConversation } from "../../../../components/tickets/order-conversation";
import { OrderConversationDialog } from "../../../../components/tickets/order-conversation-dialog";
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
      context.user.tickets.view ? context.services.tickets.getOrderPage(orderId) : Promise.resolve(null),
      context.user.teamMessaging.use ? context.services.team.listConversations() : Promise.resolve([]),
    ]);

    const canViewForms = context.user.forms.submissionsView;

    const { views: taskViews, counts: taskCounts } = composeProjectTaskViews(tasks);
    const conversationTicket = conversation?.ticket ?? null;
    const legacyTicket = conversationTicket?.id !== orderId ? conversationTicket : null;
    const repliesDisabled = conversationTicket
      ? conversationTicket.status === "closed" || Boolean(conversationTicket.archived_at)
      : false;
    const conversationMessages = conversation?.messages ?? [];
    const internalNotes = context.user.tickets.internalNotes && legacyTicket ? await context.services.tickets.getOrderNotes(orderId) : [];

    return (
      <>
        <OrderTeamNote key={order.id} orderId={order.id} note={order.notes} canEdit={context.user.projects.edit && !order.archived_at} />

        <section className={styles.fieldsCard} aria-labelledby="order-fields-heading">
          <h2 id="order-fields-heading" className={styles.sectionHeading}>
            Form responses
          </h2>

          {canViewForms ? (
            <OrderSubmittedForms forms={context.services.forms} orderId={order.id} companyId={order.company_id} />
          ) : (
            <p className={styles.panelEmpty}>
              You do not have permission to view Form submissions.
            </p>
          )}
        </section>

        {context.user.tickets.view ? <OrderConversationDialog key={orderId}>
          <OrderConversation
            orderId={orderId}
            viewerProfileId={context.user.id}
            messages={conversationMessages}
            initialPage={conversation?.page}
            heading={`Project #${order.order_number}`}
            destinations={legacyTicket ? toTeamConversationViews(teamConversations) : []}
            canReply={context.user.tickets.reply}
            repliesDisabled={repliesDisabled}
            headerActions={
              context.user.tickets.internalNotes && legacyTicket ? (
                <InternalNotesModal
                  target={{ kind: "order", orderId }}
                  notes={internalNotes}
                  disabled={Boolean(legacyTicket.archived_at)}
                />
              ) : null
            }
          />
        </OrderConversationDialog> : null}

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
                <ProjectTasks orderId={order.id}
                  tasks={taskViews.map((task) => ({ ...task, dueLabel: task.dueAt ? formatDate(task.dueAt) : null }))}
                  people={people.map((person) => ({ id: person.id, name: person.displayName }))}
                  capabilities={order.archived_at ? { create: false, edit: false, assign: false, archive: false } : context.user.projects} />
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
