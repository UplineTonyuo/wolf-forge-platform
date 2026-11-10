import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { projectAttention } from "../../../domain/client-portal/attention";
import type { ClientProjectView } from "../../../domain/orders/client-projections";
import type { TicketDetail } from "../../../domain/tickets/schema";
import type { OrderPageInfo } from "../../../domain/orders/conversation-page";
import { ProjectConversation } from "../../tickets/project-conversation";
import { AttentionPill } from "../ui/attention-pill";
import { PortalProgressBar } from "../ui/portal-progress-bar";
import type { ReactNode } from "react";
import styles from "./client-project-detail.module.css";

export { ClientProjectsList } from "./client-projects-list";

export function ClientProjectDetail({
  project,
  conversation,
  viewerId,
  startControl,
  chatAccess,
}: {
  project: ClientProjectView;
  conversation: (TicketDetail & {page?:OrderPageInfo}) | null;
  /** The signed-in client's profile id, so message ownership comes from the
   *  authenticated user rather than from the client role. */
  viewerId: string;
  startControl?: ReactNode;
  chatAccess: "locked" | "unlocked" | "unavailable";
}) {
  const attention = projectAttention(project.status);
  const conversationTicket = conversation?.ticket ?? null;
  const repliesDisabled = conversationTicket
    ? conversationTicket.status === "closed" || Boolean(conversationTicket.archived_at)
    : false;

  /*
   * Only facts the read model actually carries. A field with no value is shown
   * with an em dash rather than being hidden, so the client can see that Wolf
   * Forge has not set a due date rather than wondering where it went.
   */
  const facts: Array<{ label: string; value: string }> = [
    { label: "Reference", value: project.reference },
    { label: "Service", value: project.serviceName ?? "Not set" },
    { label: "Opened", value: project.createdLabel },
    { label: "Started", value: project.startedLabel ?? "Not started yet" },
    { label: "Due", value: project.dueLabel ?? "No due date" },
    { label: "Completed", value: project.completedLabel ?? "Not completed yet" },
  ];

  return (
    <div className="portal-page">
      <Link href="/account/projects" className="portal-back">
        <ArrowLeft aria-hidden={true} />
        All orders
      </Link>

      <header className={`portal-page-head portal-page-head-actions ${styles.heading}`}>
        <div>
          <span className="portal-eyebrow">{project.reference}</span>
          <h1>{project.title}</h1>
          {project.serviceName ? <p>{project.serviceName}</p> : null}
        </div>
        <AttentionPill tone={attention.tone} label={attention.label} />
      </header>

      {attention.tone === "waiting_on_you" ? (
        <div className="portal-callout" data-tone="waiting_on_you">
          <strong>This order is waiting on you.</strong>
          <span>
            Wolf Forge needs something from you before this can move forward.{" "}
            <Link href="/account/messages">Send us a message</Link> if you are not sure what.
          </span>
        </div>
      ) : null}

      <div className={styles.workspace}>
      <section className={`portal-section ${styles.conversation}`} aria-labelledby="portal-project-conversation">
        <h2 id="portal-project-conversation" className="sr-only">Conversation</h2>
        {chatAccess === "unlocked" ? <ProjectConversation
          orderId={project.id}
          heading={project.reference}
          messages={conversation?.messages ?? []}
          initialPage={conversation?.page}
          viewerProfileId={viewerId}
          repliesDisabled={repliesDisabled}
        /> : <p role="status">{chatAccess === "locked"
          ? "Complete all required service forms to open this conversation. If a form is unavailable, contact the team."
          : "Conversation access could not be confirmed. Reload to try again."}</p>}
      </section>

      <aside className={styles.sidebar} aria-label="Order information">
      {startControl}
      <section className="portal-section" aria-labelledby="portal-project-progress">
        <header className="portal-section-head">
          <h2 id="portal-project-progress">Delivery progress</h2>
        </header>

        <div className="portal-card">
          <p>
            {project.progress.total === 0
              ? "Progress appears here once the delivery plan is in place."
              : `${project.progress.completed} of ${project.progress.total} delivery steps complete.`}
          </p>
          {/*
           * Aggregate counts only. Individual task titles are internal
           * operational phrasing and never cross into the portal.
           */}
          <PortalProgressBar
            percent={project.progress.percent}
            label={
              project.progress.total === 0
                ? null
                : `${project.progress.completed} of ${project.progress.total} steps complete`
            }
          />
        </div>
      </section>

      <section className="portal-section" aria-labelledby="portal-project-facts">
        <header className="portal-section-head">
          <h2 id="portal-project-facts">Details</h2>
        </header>
        <dl className={`portal-fact-grid ${styles.facts}`}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      </aside>
      </div>
    </div>
  );
}
