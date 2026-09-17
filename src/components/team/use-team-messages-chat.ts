"use client";

import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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

  const enabled = user.teamMessaging.use;
  const deepLinkId = searchParams.get("team-messages");

  /*
   * A team notification links to ?team-messages=<id>. Honoured once per
   * distinct link, adjusted during render rather than in an effect so the
   * drawer opens on the same paint the URL arrives on.
   */
  const [consumedDeepLink, setConsumedDeepLink] = useState<string | null>(
    null,
  );
  if (enabled && deepLinkId && deepLinkId !== consumedDeepLink) {
    setConsumedDeepLink(deepLinkId);
    setIsOpen(true);
  }

  const close = useCallback(() => setIsOpen(false), []);
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
    deepLinkId: enabled ? deepLinkId : null,
    setDrawerEl,
    getDrawerEl,
  };
}

export type TeamMessagesChat = ReturnType<typeof useTeamMessagesChat>;
