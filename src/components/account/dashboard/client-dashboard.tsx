import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { PaymentMethodState } from "../../../domain/client-portal/payment-method";
import type { ClientPortalSummary } from "../../../domain/client-portal/summary";
import { describeCurrencyBalance } from "../../../domain/client-portal/balance";
import { formatCurrencyCents, formatDateTime } from "../../../lib/format";
import { AttentionPill } from "../ui/attention-pill";
import { PortalProgressBar } from "../ui/portal-progress-bar";

/**
 * The client Dashboard.
 *
 * Answers four questions in order, and only with rows that exist: what needs
 * you, what is happening, what do you owe, what is next. A section whose module
 * is denied is absent rather than empty, and a section with nothing in it gets
 * a written zero state rather than a "0" tile. There are no KPI cards, no
 * charts and no invented history anywhere on this screen.
 */

function firstNameOf(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/u)[0];
  return first || null;
}

/**
 * The one screen a brand-new account sees.
 *
 * A client with nothing yet gets a single deliberate welcome and the real next
 * actions available to them — not five empty cards explaining their own
 * emptiness.
 */
function WelcomeState({
  companyName,
  displayName,
  actions,
}: {
  companyName: string;
  displayName: string | null;
  actions: Array<{ id: string; label: string; href: string; detail: string }>;
}) {
  const firstName = firstNameOf(displayName);

  return (
    <div className="portal-dashboard">
      <section className="portal-welcome">
        <span className="portal-eyebrow">Wolf Forge</span>
        <h1>{firstName ? `Welcome, ${firstName}` : "Welcome to Wolf Forge"}</h1>
        <p>
          Your workspace for {companyName} is ready. When work begins, your projects, updates,
          onboarding and billing all appear here.
        </p>
      </section>

      {actions.length > 0 ? (
        <section className="portal-next-actions" aria-label="Where to start">
          {actions.map((action) => (
            <Link key={action.id} href={action.href} className="portal-next-action">
              <span>
                <strong>{action.label}</strong>
                <span>{action.detail}</span>
              </span>
              <ArrowRight aria-hidden={true} />
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function ClientDashboard({
  companyName,
  displayName,
  summary,
  paymentMethod,
  storeGranted,
}: {
  companyName: string;
  displayName: string | null;
  summary: ClientPortalSummary;
  paymentMethod: PaymentMethodState;
  storeGranted: boolean;
}) {
  const firstName = firstNameOf(displayName);
  const { attention, activeProjects, balance, onboarding, nextBilling, recentMessages } = summary;

  if (summary.isBrandNew) {
    const actions: Array<{ id: string; label: string; href: string; detail: string }> = [];

    if (onboarding && onboarding.outstanding.length > 0) {
      actions.push({
        id: "onboarding",
        label: "Complete onboarding",
        href: "/account/onboarding",
        detail: `${onboarding.outstanding.length} ${onboarding.outstanding.length === 1 ? "item" : "items"} to complete`,
      });
    }

    if (storeGranted) {
      actions.push({
        id: "store",
        label: "Browse services",
        href: "/account/store",
        detail: "See everything Wolf Forge builds",
      });
    }

    if (summary.messagesGranted) {
      actions.push({
        id: "messages",
        label: "Message Wolf Forge",
        href: "/account/messages",
        detail: "Start a conversation with the team",
      });
    }

    return (
      <WelcomeState companyName={companyName} displayName={displayName} actions={actions} />
    );
  }

  /*
   * The context line under the greeting is a plain sentence about the account's
   * actual state, chosen from real counts rather than a static tagline.
   */
  const contextLine = attention.length > 0
    ? `${attention.length} ${attention.length === 1 ? "thing needs" : "things need"} your attention today.`
    : activeProjects.length > 0
      ? `Wolf Forge is working on ${activeProjects.length} ${activeProjects.length === 1 ? "project" : "projects"} for you. Nothing is waiting on you.`
      : "Nothing is waiting on you right now.";

  return (
    <div className="portal-dashboard">
      <section className="portal-welcome">
        <span className="portal-eyebrow">{companyName}</span>
        <h1>{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
        <p>{contextLine}</p>
      </section>

      {attention.length > 0 ? (
        <section className="portal-section" aria-labelledby="portal-attention">
          <header className="portal-section-head">
            <h2 id="portal-attention">Needs your attention</h2>
          </header>

          <ul className="portal-attention-list">
            {attention.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="portal-attention-row" data-tone={item.tone}>
                  <span className="portal-attention-body">
                    <strong>{item.label}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </span>
                  <span className="portal-attention-cta">
                    {item.cta}
                    <ArrowRight aria-hidden={true} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.totalProjects !== null ? (
        <section className="portal-section" aria-labelledby="portal-active-work">
          <header className="portal-section-head">
            <h2 id="portal-active-work">Active work</h2>
            <Link className="portal-secondary-action" href="/account/projects">
              All projects
              <ArrowUpRight aria-hidden={true} />
            </Link>
          </header>

          {activeProjects.length === 0 ? (
            <p className="portal-empty">
              {summary.totalProjects === 0
                ? "No projects yet. When Wolf Forge starts work for your account, it appears here."
                : "Nothing is in progress right now. Your completed projects are on the Projects page."}
            </p>
          ) : (
            <ul className="portal-work-list">
              {activeProjects.map((project) => (
                <li key={project.id}>
                  <Link href={project.href} className="portal-work-row">
                    <span className="portal-work-main">
                      <span className="portal-project-ref">{project.reference}</span>
                      <strong>{project.title}</strong>
                      {project.serviceName ? <span>{project.serviceName}</span> : null}
                    </span>

                    <span className="portal-work-meta">
                      <AttentionPill tone={project.tone} label={project.toneLabel} />
                      <PortalProgressBar
                        percent={project.progressPercent}
                        label={project.progressLabel}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {balance || nextBilling || summary.activeSubscriptionCount !== null ? (
        <section className="portal-section" aria-labelledby="portal-billing">
          <header className="portal-section-head">
            <h2 id="portal-billing">Billing</h2>
          </header>

          <div className="portal-billing-grid">
            {balance ? (
              <div className="portal-billing-card">
                <span className="portal-billing-label">Outstanding balance</span>

                {balance.currencies.length === 0 ? (
                  <>
                    <strong className="portal-billing-figure">
                      {formatCurrencyCents(0, "USD")}
                    </strong>
                    <span className="portal-billing-note">You&rsquo;re all caught up.</span>
                  </>
                ) : (
                  <>
                    {/*
                     * One figure per currency. The platform has no FX rate
                     * source, so balances in different currencies are never
                     * added together or converted.
                     */}
                    {balance.currencies.map((entry) => (
                      <span key={entry.currency} className="portal-billing-currency">
                        <strong className="portal-billing-figure">
                          {formatCurrencyCents(entry.outstandingCents, entry.currency)}
                        </strong>
                        {balance.isMultiCurrency ? (
                          <em className="portal-billing-currency-code">{entry.currency}</em>
                        ) : null}
                        <span className="portal-billing-note">
                          {describeCurrencyBalance(entry)}
                        </span>
                      </span>
                    ))}
                  </>
                )}

                <Link className="portal-secondary-action" href="/account/invoices">
                  View invoices
                  <ArrowUpRight aria-hidden={true} />
                </Link>
              </div>
            ) : null}

            {summary.activeSubscriptionCount !== null ? (
              <div className="portal-billing-card">
                <span className="portal-billing-label">Next billing</span>
                {nextBilling ? (
                  <>
                    <strong className="portal-billing-figure is-secondary">
                      {nextBilling.dateLabel}
                    </strong>
                    <span className="portal-billing-note">
                      {nextBilling.serviceName} · {nextBilling.amountLabel}
                    </span>
                  </>
                ) : (
                  <span className="portal-billing-note">
                    {summary.activeSubscriptionCount === 0
                      ? "You have no active subscriptions."
                      : "No billing date is scheduled yet."}
                  </span>
                )}

                <Link className="portal-secondary-action" href="/account/subscriptions">
                  View subscriptions
                  <ArrowUpRight aria-hidden={true} />
                </Link>
              </div>
            ) : null}

            {balance ? (
              <div className="portal-billing-card">
                <span className="portal-billing-label">Payment method</span>
                {/*
                 * Wolf Forge has no card payment provider. The truthful state
                 * is computed in domain/client-portal/payment-method.ts — this
                 * never hardcodes a brand, a last four or an expiry.
                 */}
                {paymentMethod.kind === "no_provider" ? (
                  <>
                    <strong className="portal-billing-figure is-secondary">
                      No payment method on file
                    </strong>
                    <span className="portal-billing-note">
                      Wolf Forge has not connected online payment methods to your account yet.
                    </span>
                  </>
                ) : paymentMethod.kind === "provider_no_method" ? (
                  <>
                    <strong className="portal-billing-figure is-secondary">
                      No payment method saved
                    </strong>
                    <span className="portal-billing-note">
                      Add a payment method to settle invoices online.
                    </span>
                  </>
                ) : (
                  <>
                    <strong className="portal-billing-figure is-secondary">
                      {paymentMethod.method.brand} •••• {paymentMethod.method.last4}
                    </strong>
                    <span className="portal-billing-note">
                      {paymentMethod.kind === "needs_attention"
                        ? "This payment method needs attention."
                        : "Default payment method"}
                    </span>
                  </>
                )}

                <Link className="portal-secondary-action" href="/account/payment-method">
                  Payment settings
                  <ArrowUpRight aria-hidden={true} />
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {summary.messagesGranted ? (
        <section className="portal-section" aria-labelledby="portal-recent-messages">
          <header className="portal-section-head">
            <h2 id="portal-recent-messages">Recent conversations</h2>
            <Link className="portal-secondary-action" href="/account/messages">
              All messages
              <ArrowUpRight aria-hidden={true} />
            </Link>
          </header>

          {recentMessages.length === 0 ? (
            <p className="portal-empty">
              No conversations yet. Start one whenever you need us and every reply stays here.
            </p>
          ) : (
            <ul className="portal-message-list">
              {recentMessages.map((message) => (
                <li key={message.id}>
                  <Link href={message.href} className="portal-message-row">
                    <span className="portal-message-main">
                      <span className="portal-project-ref">{message.reference}</span>
                      <strong>{message.subject}</strong>
                      <span>
                        {message.messageCount}{" "}
                        {message.messageCount === 1 ? "message" : "messages"} · updated{" "}
                        {formatDateTime(message.activityAt)}
                      </span>
                    </span>
                    <AttentionPill tone={message.tone} label={message.toneLabel} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
