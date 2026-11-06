"use server";

import {
  getClientContext,
  getInternalContext,
} from "../../lib/supabase/next-server";
import { uuidSchema } from "../../domain/shared";
import { z } from "zod";

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
  entityType?: string | null;
  audience: "internal" | "client";
  readAt: string | null;
};

export type NotificationUnreadCounts = {
  withoutTickets: number;
  withoutProjects: number;
  withoutConversations: number;
};

export type WalletNotificationResult =
  | {
      ok: true;
      notifications: WalletNotificationItem[];
      unreadCount?: number;
      unreadCounts?: NotificationUnreadCounts;
    }
  | {
      ok: false;
      error: string;
      notifications: [];
      code?: "OPENING_EXPIRED";
      serverTime?: string;
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
      entityType: row.entity_type,
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

    const result = await context.client.rpc("app_list_my_notifications", { p_limit: 50 });
    if (result.error) return failure();
    return { ok: true, notifications: normalizeRows(result.data) };
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

    return await clientNotificationFeed(context.client);
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

type NotificationClient = Awaited<ReturnType<typeof getClientContext>>["client"];
async function clientNotificationFeed(client: NotificationClient): Promise<WalletNotificationResult> {
  const result = await client.rpc("app_client_notification_feed");
  if (result.error) return failure();
  const count=z.number().int().nonnegative();
  const feed = z.object({ notifications: z.array(z.unknown()).max(50), unreadCount: count,
    unreadCounts:z.object({withoutTickets:count,withoutProjects:count,withoutConversations:count}).strict().optional(),
  }).refine(value=>!value.unreadCounts||Object.values(value.unreadCounts).every(count=>count<=value.unreadCount)).parse(result.data);
  return { ok: true, notifications: normalizeRows(feed.notifications), unreadCount: feed.unreadCount,
    ...(feed.unreadCounts ? {unreadCounts:feed.unreadCounts} : {}),
  };
}

export async function markOpenedClientNotificationsReadAction(value: unknown): Promise<WalletNotificationResult> {
  const parsed = z.object({ requestId: uuidSchema, requestedAt: z.iso.datetime({ offset: true }) }).strict().safeParse(value);
  if (!parsed.success) return failure();
  try {
    const context = await getClientContext();
    const result = await context.client.rpc("app_open_client_notifications", { p_request_id: parsed.data.requestId, p_requested_at: parsed.data.requestedAt });
    if (result.error?.code === "22023" && result.error.message === "Opening request expired or invalid") {
      return {ok:false,notifications:[],error:"This opening expired. Mark the current notifications read to continue.",code:"OPENING_EXPIRED",serverTime:new Date().toISOString()};
    }
    if (result.error) return failure();
    const receipt = z.object({ requestId: uuidSchema, snapshotAt: z.iso.datetime({ offset: true }), readCount: z.number().int().nonnegative() }).parse(result.data);
    if (receipt.requestId !== parsed.data.requestId) return failure();
    return await clientNotificationFeed(context.client);
  } catch { return failure(); }
}

export async function setClientConversationPresenceAction(
  conversationType: "ticket" | "project",
  conversationId: string,
  active: boolean,
): Promise<void> {
  try {
    const context = await getClientContext();
    await context.client.rpc("app_set_client_conversation_presence", {
      p_conversation_type: conversationType,
      p_conversation_id: uuidSchema.parse(conversationId),
      p_active: active,
    });
  } catch {
    // Presence only suppresses notification noise. Conversation access and
    // ownership are re-authorized by the database on every heartbeat.
  }
}
