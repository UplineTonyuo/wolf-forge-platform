import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { projectAttention } from "../../../domain/client-portal/attention";
import type { ClientProjectView } from "../../../domain/orders/client-projections";
import { clientProjectIsOpen } from "../../../domain/orders/client-projections";
import type { TicketDetail } from "../../../domain/tickets/schema";
import { ProjectConversation } from "../../tickets/project-conversation";
import { AttentionPill } from "../ui/attention-pill";
import { PortalProgressBar } from "../ui/portal-progress-bar";

/**
 * Read-only. The portal has no project mutation surface, and the database
 * refuses client create/update/assign/archive regardless. The view model
 * carries no internal notes, no assignee, no priority and no task titles — see
 * domain/orders/client-projections.ts, where the column list is chosen
 * explicitly rather than selected with `*`.
 *
 * Statuses are shown through the shared attention vocabulary rather than as
 * operational status codes, so "waiting_reply" reads as "Waiting on you".
 */

function ProjectRow({ project }: { project: ClientProjectView }) {
  const attention = projectAttention(project.status);

  return (
    <li>
      <Link href={`/account/projects/${project.id}`} className="portal-work-row">
        <span className="portal-work-main">
          <span className="portal-project-ref">{project.reference}</span>
          <strong>{project.title}</strong>
          <span>
            {project.serviceName ?? "Wolf Forge project"}
            {project.startedLabel ? ` · Started ${project.startedLabel}` : ""}
            {project.dueLabel ? ` · Due ${project.dueLabel}` : ""}
          </span>
        </span>

        <span className="portal-work-meta">
          <AttentionPill tone={attention.tone} label={attention.label} />
          <PortalProgressBar
            percent={project.progress.percent}
            label={
              project.progress.total === 0
                ? null
                : `${project.progress.completed} of ${project.progress.total} steps complete`
            }
          />
        </span>

        <ArrowRight aria-hidden={true} />
      </Link>
    </li>
  );
}

export function ClientProjectsList({ projects }: { projects: ClientProjectView[] }) {
  const open = projects.filter((project) => clientProjectIsOpen(project.status));
  const closed = projects.filter((project) => !clientProjectIsOpen(project.status));
  const blocked = open.filter(
    (project) => projectAttention(project.status).tone === "waiting_on_you",
  );

  // Projects the client is blocking sort first: those are the ones that will
  // not move until someone acts.
  const orderedOpen = [
    ...blocked,
    ...open.filter((project) => !blocked.includes(project)),
  ];

  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <h1>Projects</h1>
        <p>
          {projects.length === 0
            ? "Your projects will appear here once work is underway."
            : blocked.length > 0
              ? `${blocked.length} ${blocked.length === 1 ? "project needs" : "projects need"} information from you.`
              : `${open.length} in progress of ${projects.length} total.`}
        </p>
      </header>

      {projects.length === 0 ? (
        <p className="portal-empty">
          Nothing here yet. When the Wolf Forge team starts work for your account, each project
          shows up on this page with its status and progress.
        </p>
      ) : (
        <>
          {orderedOpen.length > 0 ? (
            <section className="portal-section" aria-labelledby="portal-projects-open">
              <header className="portal-section-head">
                <h2 id="portal-projects-open">In progress</h2>
              </header>
              <ul className="portal-work-list">
                {orderedOpen.map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </ul>
            </section>
          ) : null}

          {closed.length > 0 ? (
            <section className="portal-section" aria-labelledby="portal-projects-closed">
              <header className="portal-section-head">
                <h2 id="portal-projects-closed">Completed</h2>
              </header>
              <ul className="portal-work-list">
                {closed.map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ClientProjectDetail({
  project,
  conversation,
  viewerId,
}: {
  project: ClientProjectView;
  conversation: TicketDetail | null;
  /** The signed-in client's profile id, so message ownership comes from the
   *  authenticated user rather than from the client role. */
  viewerId: string;
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
        All projects
      </Link>

      <header className="portal-page-head portal-page-head-actions">
        <div>
          <span className="portal-eyebrow">{project.reference}</span>
          <h1>{project.title}</h1>
          {project.serviceName ? <p>{project.serviceName}</p> : null}
        </div>
        <AttentionPill tone={attention.tone} label={attention.label} />
      </header>

      {attention.tone === "waiting_on_you" ? (
        <div className="portal-callout" data-tone="waiting_on_you">
          <strong>This project is waiting on you.</strong>
          <span>
            Wolf Forge needs something from you before this can move forward.{" "}
            <Link href="/account/messages">Send us a message</Link> if you are not sure what.
          </span>
        </div>
      ) : null}

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
        <dl className="portal-fact-grid">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="portal-section" aria-labelledby="portal-project-conversation">
        <h2 id="portal-project-conversation" className="sr-only">
          Conversation
        </h2>
        <ProjectConversation
          orderId={project.id}
          heading={project.reference}
          messages={conversation?.messages ?? []}
          viewerProfileId={viewerId}
          repliesDisabled={repliesDisabled}
        />
      </section>
    </div>
  );
}
