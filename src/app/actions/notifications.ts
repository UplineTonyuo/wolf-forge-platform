"use server";

import {
  getClientContext,
  getInternalContext,
} from "../../lib/supabase/next-server";

export type NotificationCategory =
  | "project"
  | "client"
  | "form"
  | "coupon"
  | "ticket"
  | "payment"
  | "wallet"
  | "store"
  | "report"
  /* Internal staff-to-staff messaging. Never deliverable to a client account. */
  | "team";

export type WalletNotificationItem = {
  id: string;
  companyId: string | null;
  title: string;
  body: string;
  reason: string | null;
  createdAt: string;
  href: string;
  kind: "credit" | "debit";
  category: NotificationCategory;
  audience: "internal" | "client";
  readAt: string | null;
};

export type WalletNotificationResult =
  | {
      ok: true;
      notifications: WalletNotificationItem[];
    }
  | {
      ok: false;
      error: string;
      notifications: [];
    };

type NotificationRpcRow = {
  id: string;
  company_id: string | null;
  audience: "internal" | "client";
  category: NotificationCategory;
  variant: "info" | "credit" | "debit";
  title: string;
  body: string;
  href: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_profile_id: string | null;
  event_key: string;
  read_at: string | null;
  created_at: string;
};

function normalizeRows(
  data: unknown,
): WalletNotificationItem[] {
  const rows =
    (data ?? []) as NotificationRpcRow[];

  return rows.map(
    (row) => ({
      id: row.id,
      companyId: row.company_id,
      title: row.title,
      body: row.body,
      reason: null,
      createdAt: row.created_at,
      href: row.href,
      kind:
        row.variant === "debit"
          ? "debit"
          : "credit",
      category: row.category,
      audience: row.audience,
      readAt: row.read_at,
    }),
  );
}

function failure(): WalletNotificationResult {
  return {
    ok: false,
    error:
      "Notifications could not be loaded.",
    notifications: [],
  };
}

/**
 * Compatibility name retained so the existing internal command bar
 * does not need a risky wholesale rewrite.
 *
 * It now returns the unified notification feed, not wallet-only rows.
 */
export async function getWalletNotificationsAction(): Promise<
  WalletNotificationResult
> {
  try {
    const context =
      await getInternalContext();

    const result =
      await context.client.rpc(
        "app_list_my_notifications",
        {
          p_limit: 50,
        },
      );

    if (result.error) {
      return failure();
    }

    return {
      ok: true,
      notifications:
        normalizeRows(
          result.data,
        ),
    };
  } catch {
    return failure();
  }
}

export async function getClientNotificationsAction(): Promise<
  WalletNotificationResult
> {
  try {
    const context =
      await getClientContext();

    const result =
      await context.client.rpc(
        "app_list_my_notifications",
        {
          p_limit: 50,
        },
      );

    if (result.error) {
      return failure();
    }

    return {
      ok: true,
      notifications:
        normalizeRows(
          result.data,
        ),
    };
  } catch {
    return failure();
  }
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<void> {
  try {
    const context =
      await getInternalContext();

    await context.client.rpc(
      "app_mark_notification_read",
      {
        p_notification_id:
          notificationId,
      },
    );
  } catch {
    // Read state is best-effort UI state.
    // Authorization remains database enforced.
  }
}

export async function markClientNotificationReadAction(
  notificationId: string,
): Promise<void> {
  try {
    const context =
      await getClientContext();

    await context.client.rpc(
      "app_mark_notification_read",
      {
        p_notification_id:
          notificationId,
      },
    );
  } catch {
    // Same rule as the internal bell.
  }
}

export async function markAllNotificationsReadAction(): Promise<void> {
  try {
    const context =
      await getInternalContext();

    await context.client.rpc(
      "app_mark_all_notifications_read",
    );
  } catch {
    // Best effort.
  }
}

export async function markAllClientNotificationsReadAction(): Promise<void> {
  try {
    const context =
      await getClientContext();

    await context.client.rpc(
      "app_mark_all_notifications_read",
    );
  } catch {
    // Best effort.
  }
}