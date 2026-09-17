"use client";

import { MessagesSquare } from "lucide-react";
import { teamUnreadBadgeLabel } from "../../domain/team/projections";
import type { InternalUser } from "../../lib/supabase/next-server";
import { TeamMessagesDrawer } from "./team-messages-drawer";
import type { TeamMessagesChat } from "./use-team-messages-chat";
import styles from "./team-messages.module.css";

/**
 * The Team Messages control in the workspace command bar, between Search and
 * Notifications on desktop. Hidden on mobile (<=767px, see globals.css),
 * where the mobile edge lever (mobile-team-messages-lever.tsx) is the entry
 * point instead — both share the one `chat` state from useTeamMessagesChat,
 * lifted up to and mounted once by the workspace command bar, so there is
 * still only ever one `<TeamMessagesDrawer>` (and its one Team
 * synchronization controller) regardless of breakpoint.
 *
 * Renders nothing at all without team_messages.use. That is presentation, not
 * protection — every RPC behind the drawer refuses the same account
 * independently — but an icon that opens an empty, permanently failing panel
 * would be worse than no icon.
 */
export function TeamMessagesTrigger({
  user,
  chat,
}: {
  user: InternalUser;
  chat: TeamMessagesChat;
}) {
  if (!chat.enabled) return null;

  const badge = teamUnreadBadgeLabel(chat.unread);

  return (
    <>
      <button
        type="button"
        className="workspace-command-button"
        style={{ position: "relative" }}
        aria-label={
          chat.unread > 0
            ? `Team Messages, ${chat.unread} unread`
            : "Team Messages"
        }
        title="Team Messages"
        aria-expanded={chat.isOpen}
        aria-haspopup="dialog"
        onClick={chat.toggle}
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
        open={chat.isOpen}
        onClose={chat.close}
        actorProfileId={user.id}
        actorName={user.displayName}
        canManageTasks={user.teamMessaging.manageTasks}
        initialConversationId={chat.isOpen ? chat.deepLinkId : null}
        onUnreadChange={chat.setUnread}
        onRequestOpen={chat.openChat}
        onRootElement={chat.setDrawerEl}
      />
    </>
  );
}
