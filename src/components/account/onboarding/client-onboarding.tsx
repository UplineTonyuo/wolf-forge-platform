import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import type { ClientOnboarding, OnboardingItem } from "../../../domain/client-portal/onboarding";
import { AttentionPill } from "../ui/attention-pill";

/**
 * Client Onboarding.
 *
 * Every row is a Form Wolf Forge actually assigned to this account. Nothing on
 * this screen is a suggested, template or example requirement — if Wolf Forge
 * has not assigned it, the client does not see it.
 */

function OnboardingRow({ item }: { item: OnboardingItem }) {
  const done = item.attention.tone === "completed";

  return (
    <li>
      <Link href={item.href} className="portal-onboarding-row" data-done={done ? "true" : "false"}>
        <span className="portal-onboarding-mark" aria-hidden="true">
          {done ? <Check /> : null}
        </span>

        <span className="portal-onboarding-body">
          <strong>{item.title}</strong>
          <span>
            {item.context}
            {item.required ? null : " · Optional"}
            {done && item.completedLabel
              ? ` · Completed ${item.completedLabel}`
              : item.dueLabel
                ? ` · Due ${item.dueLabel}`
                : ""}
          </span>
        </span>

        <span className="portal-onboarding-meta">
          <AttentionPill tone={item.attention.tone} label={item.attention.label} />
          <span className="portal-onboarding-cta">
            {item.action}
            <ArrowRight aria-hidden={true} />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function ClientOnboardingView({ onboarding }: { onboarding: ClientOnboarding }) {
  const { progress, groups, outstanding } = onboarding;

  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <h1>Onboarding</h1>
        <p>
          Complete these items so Wolf Forge can begin or continue your work. Everything you send
          stays attached to your account.
        </p>
      </header>

      {progress === null ? (
        <p className="portal-empty">
          Nothing is required from you yet. When Wolf Forge needs information to start or continue
          your work, the request appears here.
        </p>
      ) : (
        <>
          {/*
           * A count of real rows, never a percentage: five items is too few a
           * denominator for a percentage to mean anything, and there is no
           * partial-completion state stored per item to base one on.
           */}
          <p className="portal-progress-line">
            <strong>
              {progress.completed} of {progress.total} completed
            </strong>
            {outstanding.length > 0 ? (
              <span>
                {outstanding.length} still {outstanding.length === 1 ? "needs" : "need"} your input
              </span>
            ) : (
              <span>{groups.some((group) => group.items.some((item) => item.action === "Paused")) ? "Collection is paused. Outstanding requests are retained." : "You’re all caught up."}</span>
            )}
          </p>

          {groups.map((group) => (
            <section
              className="portal-section"
              key={group.id}
              aria-labelledby={`onboarding-${group.id}`}
            >
              <header className="portal-section-head">
                <div>
                  <h2 id={`onboarding-${group.id}`}>{group.label}</h2>
                  <p>{group.description}</p>
                </div>
              </header>

              <ul className="portal-onboarding-list">
                {group.items.map((item) => (
                  <OnboardingRow key={item.assignmentId} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
