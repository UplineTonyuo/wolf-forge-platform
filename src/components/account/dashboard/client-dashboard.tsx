import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ClientPaymentRail } from "../../../domain/payments/payment-rails";
import type { ClientPortalSummary } from "../../../domain/client-portal/summary";
import {
  composeAttentionChips,
  composeNextActionFlow,
} from "../../../domain/client-portal/next-action";
import { ActiveWorkSection } from "./active-work";
import { BillingStripSection } from "./billing-strip";
import { RecentConversationsSection } from "./conversations-stack";
import { DashboardHero } from "./dashboard-hero";
import { NextActionFlowSection } from "./next-action-flow";

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
          forms and billing all appear here.
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
  paymentRails,
  storeGranted,
}: {
  companyName: string;
  displayName: string | null;
  summary: ClientPortalSummary;
  /** Null when the account does not hold the Invoices module. */
  paymentRails: ClientPaymentRail[] | null;
  storeGranted: boolean;
}) {
  const firstName = firstNameOf(displayName);
  const { attention, activeProjects, balance, onboarding, nextBilling, recentMessages } = summary;

  if (summary.isBrandNew) {
    const actions: Array<{ id: string; label: string; href: string; detail: string }> = [];

    if (onboarding && onboarding.outstanding.length > 0) {
      actions.push({
        id: "onboarding",
        label: "Complete required forms",
        href: "/account/projects#forms",
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
      ? `Wolf Forge is working on ${activeProjects.length} ${activeProjects.length === 1 ? "order" : "orders"} for you. Nothing is waiting on you.`
      : "Nothing is waiting on you right now.";

  /*
   * Ranking and chips are pure projections of the summary above. The attention
   * list itself is untouched: nothing is added, dropped or re-routed here, and
   * the count the hero shows is the domain's own length.
   */
  const flow = composeNextActionFlow(summary);
  const chips = composeAttentionChips(summary);

  return (
    <div className="portal-dashboard">
      <DashboardHero
        companyName={companyName}
        greeting={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        contextLine={contextLine}
        count={flow.count}
        chips={chips}
      />

      <NextActionFlowSection flow={flow} />

      {summary.totalProjects !== null ? (
        <ActiveWorkSection projects={activeProjects} totalProjects={summary.totalProjects} />
      ) : null}

      {balance || nextBilling || summary.activeSubscriptionCount !== null ? (
        <BillingStripSection
          balance={balance}
          nextBilling={nextBilling}
          activeSubscriptionCount={summary.activeSubscriptionCount}
          paymentRails={paymentRails}
        />
      ) : null}

      {summary.messagesGranted ? (
        <RecentConversationsSection messages={recentMessages} />
      ) : null}
    </div>
  );
}
