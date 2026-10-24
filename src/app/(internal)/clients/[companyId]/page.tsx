import type { Metadata } from "next";
import { ClientContactEmail } from "../../../../components/clients/client-contact-email";
import {
  Activity,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  FolderKanban,
  History,
  Mail,
  Phone,
  ReceiptText,
  UserRound,
  CreditCard,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataError } from "../../../../components/ui/list-states";
import { ClientDetailActions } from "../../../../components/clients/client-detail-actions";
import { ClientStatusControl } from "../../../../components/clients/client-status-control";
import { ClientBalanceControl } from "../../../../components/clients/client-balance-control";
import { WfCardMembershipControl } from "../../../../components/clients/wf-card-membership-control";
import { PageFrame } from "../../../../components/ui/page-frame";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { canSendClientWelcomeEmail } from "../../../../lib/email/client-welcome-email-server";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatDate } from "../../../../lib/format";
import type { ActivityEventRow } from "../../../../lib/supabase/database-rows";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Client" };

type ClientTab =
  | "details"
  | "projects"
  | "invoices"
  | "activities"
  | "history";

const tabs: Array<{
  id: ClientTab;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: "details", label: "Details", icon: UserRound },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "invoices", label: "Invoices", icon: ReceiptText },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "history", label: "History", icon: History },
];

function normalizeTab(value: string | undefined): ClientTab {
  if (
    value === "projects" ||
    value === "invoices" ||
    value === "activities" ||
    value === "history"
  ) {
    return value;
  }

  return "details";
}


function formatHistoryDay(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function historyCategory(event: ActivityEventRow) {
  if (event.entity_type === "company") return "Client";
  if (event.entity_type === "client_contact") return "Contact";
  if (event.entity_type === "order") return "Project";
  if (event.entity_type === "order_task") return "Task";
  if (event.entity_type === "service") return "Service";
  return "Account";
}

function groupHistory(events: ActivityEventRow[]) {
  const groups = new Map<string, ActivityEventRow[]>();

  for (const event of events) {
    const day = formatHistoryDay(event.created_at);
    const existing = groups.get(day) ?? [];
    existing.push(event);
    groups.set(day, existing);
  }

  return Array.from(groups.entries());
}
export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    created?: string;
    welcome?: string;
    tab?: string;
    historyLimit?: string;
  }>;
}) {
  const { companyId } = await params;
  const query = await searchParams;
  const activeTab = normalizeTab(query.tab);
  const context = await getInternalContext();

  try {
    const [client, contacts, projects, wallet, wfCardMembership] = await Promise.all([
      context.services.companies.get(companyId),
      context.user.clients.privateManage
        ? context.services.contacts.listForCompany(companyId)
        : Promise.resolve([]),
      context.services.orders.listForCompany(companyId),
      context.user.clients.privateManage
        ? context.services.wallets.getForCompany(companyId)
        : Promise.resolve(null),
      // Missing is a real answer here: most companies hold no membership row at
      // all, and that is simply "not active" rather than an error.
      context.user.invoices.manage
        ? context.services.wfCard.getMembership(companyId).catch(() => null)
        : Promise.resolve(null),
    ]);

    const openProjects = projects.filter(
      (project) =>
        !["complete", "canceled"].includes(project.status),
    );

    const primaryContact =
      contacts.find((contact) => contact.is_primary) ??
      contacts[0] ??
      null;

    // The primary contact's portal login, when this viewer may email it a set-password link.
    const emailAvailable = await canSendClientWelcomeEmail(context);
    const welcomeEmailProfileId =
      primaryContact?.profile_id && emailAvailable
        ? primaryContact.profile_id
        : null;

    let onboardingForms: Array<{ id: string; name: string }> = [];
    let eligibleProfiles: Array<{ id: string; label: string }> = [];

    if (context.user.forms.assign) {
      const [forms, candidates] = await Promise.all([
        context.services.forms.list(),
        context.services.forms.listOnboardingCandidates(companyId),
      ]);

      onboardingForms = forms
        .filter((form) => form.form_type === "onboarding" && form.status === "published")
        .map((form) => ({ id: form.id, name: form.name }));

      eligibleProfiles = candidates.map((candidate) => ({
        id: candidate.profile_id,
        label: candidate.display_name ?? "Client",
      }));
    }

    const requestedHistoryLimit = Number(query.historyLimit ?? "20");

    const historyLimit =
      Number.isFinite(requestedHistoryLimit) &&
      requestedHistoryLimit > 0
        ? Math.min(requestedHistoryLimit, 100)
        : 20;

    let historyEvents: ActivityEventRow[] = [];

    if (activeTab === "history") {
      const timelines = await Promise.all([
        context.services.activity.listTimeline(
          "company",
          client.id,
        ),

        ...contacts.map((contact) =>
          context.services.activity.listTimeline(
            "client_contact",
            contact.id,
          ),
        ),

        ...projects.map((project) =>
          context.services.activity.listTimeline(
            "order",
            project.id,
          ),
        ),
      ]);

      historyEvents = timelines
        .flat()
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime(),
        );
    }

    const visibleHistoryEvents =
      historyEvents.slice(0, historyLimit);

    const historyGroups =
      groupHistory(visibleHistoryEvents);

    return (
      <PageFrame
        title={client.name}
        action={
          <ClientDetailActions
            companyId={client.id}
            clientName={client.name}
            clientStatus={client.status}
            primaryContact={
              primaryContact
                ? {
                    id: primaryContact.id,
                    name: primaryContact.name,
                    email: primaryContact.email,
                    phone: primaryContact.phone,
                    job_title: primaryContact.job_title,
                  }
                : null
            }
            permissions={{
              edit: context.user.clients.edit,
              privateManage: context.user.clients.privateManage,
              invoiceManage: context.user.invoices.manage,
              ticketCreate: context.user.tickets.create,
              formsAssign: context.user.forms.assign,
            }}
            onboardingForms={onboardingForms}
            eligibleProfiles={eligibleProfiles}
            welcomeEmailProfileId={welcomeEmailProfileId}
          />
        }
      >
        {query.created === "1" ? (
          <div
            className="success-banner"
            role="status"
          >
            {client.name} created.
            {query.welcome === "sent" ? " Welcome email sent with a secure set-password link." : null}
          </div>
        ) : null}

        {query.welcome === "failed" ? (
          <div
            className="form-banner"
            role="alert"
          >
            The welcome email was not sent. Check the Gmail connection in Settings &gt; Integrations, then use Actions &gt; Send welcome email.
          </div>
        ) : null}

        <div className="client-detail-context">
          <Link
            className="client-detail-back"
            href="/clients"
          >
            <ArrowLeft aria-hidden="true" />
            Clients
          </Link>

          <div className="client-detail-status-area">
            <span className="client-detail-status-label">
              Status
            </span>

            <ClientStatusControl
              companyId={client.id}
              status={client.status}
            />
          </div>
        </div>

        <nav
          className="client-detail-tabs"
          aria-label="Client sections"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const href =
              tab.id === "details"
                ? `/clients/${companyId}`
                : `/clients/${companyId}?tab=${tab.id}`;

            return (
              <Link
                key={tab.id}
                href={href}
                className={
                  activeTab === tab.id
                    ? "client-detail-tab is-active"
                    : "client-detail-tab"
                }
              >
                <Icon aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {activeTab === "details" ? (
          <div className="client-detail-content">
            <section className="client-information-panel">
              <div className="client-section-heading">
                <div>
                  <span>CLIENT INFORMATION</span>
                  <h2>Account details</h2>
                </div>
              </div>

              <dl className="client-information-list">
                <div>
                  <dt>
                    <BriefcaseBusiness aria-hidden="true" />
                    Business name
                  </dt>
                  <dd>{client.name}</dd>
                </div>

                <div>
                  <dt>
                    <CalendarDays aria-hidden="true" />
                    Created
                  </dt>
                  <dd>{formatDate(client.created_at)}</dd>
                </div>

                <div>
                  <dt>
                    <UserRound aria-hidden="true" />
                    Primary contact
                  </dt>
                  <dd>
                    {context.user.clients.privateManage ? primaryContact?.name ?? "Not set" : "Restricted"}
                  </dd>
                </div>

                <div>
                  <dt>
                    <Mail aria-hidden="true" />
                    Email
                  </dt>
                  <dd>
                    {context.user.clients.privateManage ? primaryContact?.email
                      ? <ClientContactEmail contactId={primaryContact.id} name={primaryContact.name} email={primaryContact.email} available={emailAvailable} />
                      : "Not available" : "Restricted"}
                  </dd>
                </div>

                <div>
                  <dt>
                    <Phone aria-hidden="true" />
                    Phone
                  </dt>
                  <dd>
                    {context.user.clients.privateManage ? primaryContact?.phone ?? "Not available" : "Restricted"}
                  </dd>
                </div>

                <div>
                  <dt>
                    <BriefcaseBusiness aria-hidden="true" />
                    Job title
                  </dt>
                  <dd>
                    {context.user.clients.privateManage ? primaryContact?.job_title ?? "Not available" : "Restricted"}
                  </dd>
                </div>

                {wallet ? <div className="client-balance-row">
                  <dt>
                    <WalletCards aria-hidden="true" />
                    Account balance
                  </dt>

                  <dd>
                    <ClientBalanceControl
                      companyId={client.id}
                      clientName={primaryContact?.name ?? client.name}
                      balanceCents={Number(wallet.balance_cents)}
                      currency={wallet.currency}
                    />
                  </dd>
                </div> : null}

                {context.user.invoices.manage ? <div className="client-balance-row">
                  <dt>
                    <CreditCard aria-hidden="true" />
                    WF Card membership
                  </dt>

                  <dd>
                    <WfCardMembershipControl
                      companyId={client.id}
                      status={wfCardMembership?.status ?? null}
                    />
                  </dd>
                </div> : null}
              </dl>
            </section>

            <section className="client-side-summary">
              <div className="client-section-heading">
                <div>
                  <span>DELIVERY</span>
                  <h2>Open projects</h2>
                </div>

                <strong>{openProjects.length}</strong>
              </div>

              {openProjects.length ? (
                <div className="client-project-summary">
                  {openProjects
                    .slice(0, 5)
                    .map((project) => (
                      <Link
                        key={project.id}
                        href={`/orders/${project.id}`}
                        className="client-project-summary-row"
                      >
                        <div>
                          <strong>
                            #{project.order_number}{" "}
                            {project.title}
                          </strong>
                        </div>

                        <StatusBadge
                          status={project.status}
                        />
                      </Link>
                    ))}
                </div>
              ) : (
                <p className="client-detail-empty">
                  No open projects.
                </p>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "projects" ? (
          <section className="client-tab-panel">
            <div className="client-section-heading">
              <div>
                <span>PROJECTS</span>
                <h2>Client projects</h2>
              </div>

              <strong>{projects.length}</strong>
            </div>

            {projects.length ? (
              <div className="client-project-summary">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/orders/${project.id}`}
                    className="client-project-summary-row"
                  >
                    <div>
                      <strong>
                        #{project.order_number}{" "}
                        {project.title}
                      </strong>
                    </div>

                    <StatusBadge
                      status={project.status}
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="client-detail-empty">
                No projects for this client yet.
              </p>
            )}
          </section>
        ) : null}

        {activeTab === "invoices" ? (
          <section className="client-tab-panel">
            <div className="client-section-heading">
              <div>
                <span>INVOICES</span>
                <h2>Billing history</h2>
              </div>
            </div>

            <p className="client-detail-empty">
              Invoice relationships will appear here when the billing domain is connected.
            </p>
          </section>
        ) : null}

        {activeTab === "activities" ? (
          <section className="client-tab-panel">
            <div className="client-section-heading">
              <div>
                <span>ACTIVITIES</span>
                <h2>Client activity</h2>
              </div>
            </div>

            <p className="client-detail-empty">
              Client activity will appear here when the activity feed is connected to this view.
            </p>
          </section>
        ) : null}

        {activeTab === "history" ? (
          <section className="client-tab-panel client-history-panel">
            <div className="client-section-heading">
              <div>
                <span>HISTORY</span>
                <h2>Account history</h2>
              </div>

              <strong>{historyEvents.length}</strong>
            </div>

            {historyGroups.length ? (
              <div className="client-history-timeline">
                {historyGroups.map(([day, events]) => (
                  <section
                    className="client-history-day"
                    key={day}
                  >
                    <h3>{day}</h3>

                    <div className="client-history-events">
                      {events.map((event) => (
                        <article
                          className="client-history-event"
                          key={event.id}
                        >
                          <div
                            className="client-history-marker"
                            aria-hidden="true"
                          >
                            <Activity />
                          </div>

                          <div className="client-history-copy">
                            <div className="client-history-meta">
                              <span>
                                {historyCategory(event)}
                              </span>

                              <time dateTime={event.created_at}>
                                {formatHistoryTime(
                                  event.created_at,
                                )}
                              </time>
                            </div>

                            <strong>{event.summary}</strong>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}

                {historyEvents.length >
                visibleHistoryEvents.length ? (
                  <div className="client-history-more">
                    <Link
                      className="button-secondary"
                      href={`/clients/${companyId}?tab=history&historyLimit=${Math.min(
                        historyLimit + 20,
                        100,
                      )}`}
                    >
                      Show older
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="client-detail-empty">
                No history recorded for this client yet.
              </p>
            )}
          </section>
        ) : null}
      </PageFrame>
    );
  } catch (error) {
    const safe = toClientSafeError(error);

    if (safe.code === "NOT_FOUND") {
      notFound();
    }

    return (
      <PageFrame title="Client">
        <DataError message={safe.message} />
      </PageFrame>
    );
  }
}
