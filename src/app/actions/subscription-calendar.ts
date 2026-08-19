"use server";

import type { SubscriptionCalendarSource } from "../../domain/subscriptions/calendar";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

export type SubscriptionCalendarResult =
  | { ok: true; sources: SubscriptionCalendarSource[] }
  | { ok: false; error: string; sources: [] };

/**
 * Owner/Admin Subscription calendar feed.
 *
 * Two independent boundaries have to agree before a row is returned: the
 * internal session boundary (`getInternalContext` redirects anyone who is not
 * staff, and `subscriptions.view` is re-checked here), and the database
 * boundary (`private.can_read_subscription` inside every Subscription RPC).
 * Nothing is filtered in the browser.
 */
export async function loadOwnerSubscriptionCalendarAction(): Promise<SubscriptionCalendarResult> {
  const context = await getInternalContext();

  if (!context.user.subscriptions.view) {
    return { ok: false, error: "You do not have permission to view Subscriptions.", sources: [] };
  }

  try {
    return { ok: true, sources: await context.services.subscriptionCalendar.listSources("owner") };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message, sources: [] };
  }
}

/**
 * Client Subscription calendar feed. The client session can only ever read its
 * own company's subscriptions, and the "client" perspective additionally drops
 * company identity from the payload before it leaves the server.
 */
export async function loadClientSubscriptionCalendarAction(): Promise<SubscriptionCalendarResult> {
  const context = await getClientContext();

  try {
    return { ok: true, sources: await context.services.subscriptionCalendar.listSources("client") };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message, sources: [] };
  }
}
