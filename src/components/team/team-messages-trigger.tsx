"use client";

import { MessagesSquare } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { teamUnreadBadgeLabel } from "../../domain/team/projections";
import type { InternalUser } from "../../lib/supabase/next-server";
import { TeamMessagesDrawer } from "./team-messages-drawer";
import styles from "./team-messages.module.css";

/**
 * The Team Messages control in the workspace command bar, between Search and
 * Notifications.
 *
 * Renders nothing at all without team_messages.use. That is presentation, not
 * protection — every RPC behind the drawer refuses the same account
 * independently — but an icon that opens an empty, permanently failing panel
 * would be worse than no icon.
 *
 * The drawer owns the one Team synchronization controller even while closed,
 * so the badge, transient peeks and open workspace all observe the same list
 * snapshots without competing timers.
 */
export function TeamMessagesTrigger({ user }: { user: InternalUser }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const searchParams = useSearchParams();

  const enabled = user.teamMessaging.use;
  const deepLinkId = searchParams.get("team-messages");

  /*
   * A team notification links to ?team-messages=<id>. Honoured once per
   * distinct link, adjusted during render rather than in an effect so the
   * drawer opens on the same paint the URL arrives on — following the link
   * should not show the workspace for a frame before the drawer appears.
   */
  const [consumedDeepLink, setConsumedDeepLink] = useState<string | null>(null);
  if (enabled && deepLinkId && deepLinkId !== consumedDeepLink) {
    setConsumedDeepLink(deepLinkId);
    setOpen(true);
  }

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  if (!enabled) return null;

  const badge = teamUnreadBadgeLabel(unread);

  return (
    <>
      <button
        type="button"
        className="workspace-command-button"
        style={{ position: "relative" }}
        aria-label={
          unread > 0 ? `Team Messages, ${unread} unread` : "Team Messages"
        }
        title="Team Messages"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <MessagesSquare aria-hidden="true" />

        <span
          className={[
            styles.triggerBadge,
            badge ? styles.triggerBadgeVisible : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          {badge || "0"}
        </span>
      </button>

      <TeamMessagesDrawer
        open={open}
        onClose={close}
        actorProfileId={user.id}
        actorName={user.displayName}
        canManageTasks={user.teamMessaging.manageTasks}
        initialConversationId={open ? deepLinkId : null}
        onUnreadChange={setUnread}
        onRequestOpen={() => setOpen(true)}
      />
    </>
  );
}
