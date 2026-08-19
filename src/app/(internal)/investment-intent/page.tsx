import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InvestmentIntentWorkspace } from "../../../components/investment-intent/investment-intent-workspace";
import { DataError } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import {
  toInvestmentIntentViews,
  type InvestmentIntentView,
} from "../../../domain/store-interest/projections";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Investment Intent" };

/**
 * Which clients are showing buying interest right now.
 *
 * The rows come from the client portal Store cart: adding an investment records
 * a durable interest signal, and removing it preserves the record rather than
 * erasing it. Nothing here is an order, a project or a payment.
 */
export default async function InvestmentIntentPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const [{ intent }, { user, services }] = await Promise.all([
    searchParams,
    getInternalContext(),
  ]);

  let intents: InvestmentIntentView[] = [];
  let denied = false;
  let loadError: string | null = null;

  try {
    /*
     * The module boundary is the authority, not the rail. Typing the URL reaches
     * this call and is refused exactly the way a hidden nav item is.
     */
    await services.permissions.requireModuleAccess("investment_intent");
    intents = toInvestmentIntentViews(await services.investmentIntent.list());
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Investment Intent could not be loaded.";
  }

  // redirect() throws its own control-flow error, so it stays outside the catch.
  if (denied) redirect("/");

  return (
    <PageFrame
      title="Investment Intent"
      description="Clients who have shown interest in an investment, newest activity first."
    >
      {loadError ? (
        <DataError message={loadError} />
      ) : (
        <InvestmentIntentWorkspace
          intents={intents}
          canManage={user.investmentIntent.manage}
          focusIntentId={intent ?? null}
        />
      )}
    </PageFrame>
  );
}
