"use server";

import {
  getInternalContext,
} from "../../lib/supabase/next-server";

export type WalletNotificationItem = {
  id: string;
  companyId: string;
  title: string;
  body: string;
  reason: string | null;
  createdAt: string;
  href: string;
  kind: "credit" | "debit";
};

export type WalletNotificationResult =
  | {
      ok: true;
      notifications:
        WalletNotificationItem[];
    }
  | {
      ok: false;
      error: string;
    };

function firstName(
  value: string,
) {
  const normalized =
    value.trim();

  if (!normalized) {
    return "Client";
  }

  return (
    normalized.split(/\s+/)[0] ??
    normalized
  );
}

function formatMoney(
  cents: number,
  currency: string,
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(cents / 100);
}

export async function getWalletNotificationsAction(): Promise<
  WalletNotificationResult
> {
  try {
    const context =
      await getInternalContext();

    const rows =
      await context.services.wallets.listRecent(
        10,
      );

    const notifications =
      rows.map((row) => {
        const amountCents =
          Number(
            row.amount_cents,
          );

        const balanceCents =
          Number(
            row.balance_after_cents,
          );

        const credit =
          amountCents > 0;

        const client =
          firstName(
            row.client_name,
          );

        const actor =
          row.is_current_actor
            ? "You"
            : row.actor_display_name
              ? firstName(
                  row.actor_display_name,
                )
              : "A Wolf Forge operator";

        const amount =
          formatMoney(
            Math.abs(
              amountCents,
            ),
            row.currency,
          );

        const balance =
          formatMoney(
            balanceCents,
            row.currency,
          );

        const title =
          credit
            ? `${actor} added ${amount} to ${client}'s balance.`
            : `${actor} deducted ${amount} from ${client}'s balance.`;

        return {
          id:
            row.transaction_id,

          companyId:
            row.company_id,

          title,

          body:
            `${client} now has ${balance} available.`,

          reason:
            row.reason,

          createdAt:
            row.created_at,

          href:
            `/clients/${row.company_id}`,

          kind:
            credit
              ? "credit"
              : "debit",
        } satisfies WalletNotificationItem;
      });

    return {
      ok: true,
      notifications,
    };
  } catch {
    return {
      ok: false,
      error:
        "Wallet notifications could not be loaded.",
    };
  }
}