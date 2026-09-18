"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { InternalUser } from "../../lib/supabase/next-server";
import { useHeaderOverlay } from "../shell/use-header-overlay";

/**
 * Team Messages open/unread state, lifted out of TeamMessagesTrigger so the
 * desktop header button and the mobile edge lever can drive the same
 * `<TeamMessagesDrawer>` instance instead of each mounting their own. The
 * drawer owns the one Team synchronization controller even while closed
 * (see TeamMessagesTrigger); two mounts would mean two competing pollers.
 */
export function useTeamMessagesChat(user: InternalUser) {
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const teamEnabled = user.teamMessaging.use;
  const ticketsEnabled = user.tickets.view;
  /* The Inbox trigger must render for ticket-only staff too: the Ticket
   * Detail page no longer mounts a live conversation, so the drawer is the
   * only remaining place to read/reply to a Ticket. */
  const enabled = teamEnabled || ticketsEnabled;
  const deepLinkId = searchParams.get("team-messages");
  const ticketDeepLinkId =
    searchParams.get("inbox") === "tickets" ? searchParams.get("ticket") : null;

  /*
   * A team notification links to ?team-messages=<id>; a Ticket Detail page
   * links to ?inbox=tickets&ticket=<id>. Each is honoured once per distinct
   * link, adjusted during render rather than in an effect so the drawer
   * opens on the same paint the URL arrives on.
   */
  const [consumedDeepLink, setConsumedDeepLink] = useState<string | null>(
    null,
  );
  if (teamEnabled && deepLinkId && deepLinkId !== consumedDeepLink) {
    setConsumedDeepLink(deepLinkId);
    setIsOpen(true);
  }

  const [consumedTicketDeepLink, setConsumedTicketDeepLink] = useState<
    string | null
  >(null);
  if (
    ticketsEnabled &&
    ticketDeepLinkId &&
    ticketDeepLinkId !== consumedTicketDeepLink
  ) {
    setConsumedTicketDeepLink(ticketDeepLinkId);
    setIsOpen(true);
  }

  /*
   * Each deep link is honoured once per distinct value, so the marker has to be
   * cleared when the link leaves the URL -- otherwise the second time someone
   * follows the same link it is already "consumed" and nothing happens. That is
   * the ordinary case for a Ticket's "View in Inbox": the control lives on the
   * management page, which the reader never navigates away from, so they close
   * the Inbox and click it again. Adjusted during render, like the open above:
   * the URL is the input, this is the response to it.
   */
  if (!deepLinkId && consumedDeepLink) setConsumedDeepLink(null);
  if (!ticketDeepLinkId && consumedTicketDeepLink) {
    setConsumedTicketDeepLink(null);
  }

  const hasDeepLink = Boolean(deepLinkId || ticketDeepLinkId);

  /*
   * Closing drops any deep link from the URL. Each link is honoured once per
   * distinct value (see the render-time adjustments above), so a link that
   * stayed in the address bar would be inert the second time it is followed
   * -- which is exactly the repeat case for a Ticket's "View in Inbox", a
   * control that lives on a page you never navigate away from.
   */
  const close = useCallback(() => {
    setIsOpen(false);
    if (hasDeepLink) router.replace(pathname, { scroll: false });
  }, [hasDeepLink, pathname, router]);

  const openChat = useCallback(() => setIsOpen(true), []);
  const toggle = useCallback(() => setIsOpen((value) => !value), []);

  useHeaderOverlay("chat", isOpen, close);

  /*
   * The mobile lever (mobile-team-messages-lever.tsx) drives the drawer's
   * own root node directly during a drag, so the reveal can track the
   * finger 1:1 instead of only playing the drawer's own CSS transition.
   * TeamMessagesDrawer's `onRootElement` calls `setDrawerEl`; the lever
   * reads it back with `getDrawerEl`. A ref, not state, so neither side
   * re-renders as the drawer mounts or unmounts -- exposed as functions
   * (not the ref object itself) since mutating `.current` reached through
   * a prop chain trips the react-hooks/immutability lint rule.
   */
  const drawerElRef = useRef<HTMLDivElement | null>(null);
  const setDrawerEl = useCallback((el: HTMLDivElement | null) => {
    drawerElRef.current = el;
  }, []);
  const getDrawerEl = useCallback(() => drawerElRef.current, []);

  return {
    enabled,
    isOpen,
    unread,
    setUnread,
    close,
    openChat,
    toggle,
    deepLinkId: teamEnabled ? deepLinkId : null,
    ticketDeepLinkId: ticketsEnabled ? ticketDeepLinkId : null,
    teamEnabled,
    ticketsEnabled,
    setDrawerEl,
    getDrawerEl,
  };
}

export type TeamMessagesChat = ReturnType<typeof useTeamMessagesChat>;
