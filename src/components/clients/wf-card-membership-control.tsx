"use client";

import { CreditCard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setWfCardMembershipAction } from "../../app/actions/store-purchase";
import type { WfCardMembershipStatus } from "../../domain/wf-card/schema";

/**
 * The WF Card entitlement, from the client record where the rest of this
 * company's money already lives.
 *
 * This grants an entitlement; it does not sell one. Until a client-facing
 * membership purchase exists, Wolf Forge has been activating memberships by
 * hand in the database — this is the same act, audited, behind invoices.manage,
 * and reversible. The wording says so rather than implying a sale happened.
 *
 * Without it the company cannot settle an invoice or buy from the Store with its
 * Wolf Forge Balance, so the status is stated plainly rather than hidden behind
 * the toggle.
 */
export function WfCardMembershipControl({
  companyId,
  status,
}: {
  companyId: string;
  status: WfCardMembershipStatus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = status === "active";

  function toggle() {
    setError(null);
    const requestId = crypto.randomUUID();

    startTransition(async () => {
      const result = await setWfCardMembershipAction({
        companyId,
        active: !active,
        requestId,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="wf-card-membership">
      <span className="wf-card-membership-state" data-active={active}>
        <CreditCard aria-hidden="true" />
        {active ? "Active" : "Not active"}
      </span>

      <button
        type="button"
        className="wf-card-membership-toggle"
        onClick={toggle}
        disabled={pending}
      >
        {pending ? "Saving…" : active ? "Deactivate" : "Activate"}
      </button>

      {error ? (
        <span className="wf-card-membership-error" role="alert">
          {error}
        </span>
      ) : null}

      <span className="wf-card-membership-note">
        {active
          ? "This client can pay invoices and purchase investments from their Wolf Forge Balance."
          : "Grants access to the Wolf Forge Balance rail. This records the entitlement; it does not take payment."}
      </span>
    </div>
  );
}
