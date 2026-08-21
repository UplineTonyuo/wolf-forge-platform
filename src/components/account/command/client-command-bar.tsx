"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AccountAvatar } from "../../ui/account-avatar";
import { ClientCartPanel } from "../cart/client-cart-panel";
import { ClientNotificationBell } from "../client-notification-bell";
import { ClientCalendarAction } from "./client-calendar-action";
import { ClientQuickAction, requestNewMessage } from "./client-quick-action";
import { ClientSearch } from "./client-search";
import { HeaderPanelsProvider, useHeaderPanels } from "./header-panels";

/**
 * The client command bar.
 *
 * The same family as the internal WorkspaceCommandBar — search, then a row of
 * actions — without inheriting any of its internal-only ones. It is a distinct
 * component rather than a shared one for the same reason the rails are
 * distinct: nothing internal should be reachable from client code by changing a
 * flag.
 *
 * Reading order, left to right:
 *
 *   search         investments, scoped and labelled as such
 *   calendar-days  opens the Subscription calendar; a modal, not a panel
 *   cart           opens the request cart
 *   bell           opens the notifications panel
 *   plus           opens the quick-action panel, which also carries the
 *                  new-message action ("Message Wolf Forge")
 *   avatar         links to the profile page
 *
 * Every panelled control shares one manager, so exactly one floating surface
 * can be open at a time and none can sit on top of another. The calendar is
 * the one direct action — it closes whatever panel was open before putting a
 * dialog on screen. The + and the avatar sit together in a trailing group so
 * they read as the account's creation and identity controls, apart from the
 * utility icons.
 */
function CommandBarActions({
  displayName,
  companyName,
  avatarUrl,
  canMessage,
  notificationSoundEnabled,
  onCompose,
}: {
  displayName: string | null;
  companyName: string;
  avatarUrl: string | null;
  canMessage: boolean;
  notificationSoundEnabled: boolean;
  onCompose: () => void;
}) {
  const panels = useHeaderPanels();

  return (
    <div className="portal-command-bar" aria-label="Workspace controls">
      <ClientSearch />

      <div className="portal-command-actions">
        <ClientCalendarAction />

        <ClientCartPanel />

        <ClientNotificationBell soundEnabled={notificationSoundEnabled} inCommandBar />

        {/*
         * The + and the avatar read as one distinct pair — the account's
         * creation and identity controls — separated from the utility icons by
         * a larger gap. The + already carries the new-message action ("Message
         * Wolf Forge"), so there is no standalone compose icon in the header.
         */}
        <div className="portal-command-trailing">
          <ClientQuickAction canMessage={canMessage} onNavigateToMessages={onCompose} />

          <Link
            href="/account/profile"
            className="portal-command-avatar"
            aria-label="Your profile"
            title="Your profile"
            onPointerEnter={() => panels?.hoverLeave()}
            onClick={() => panels?.close()}
          >
            <AccountAvatar name={displayName ?? companyName} avatarUrl={avatarUrl} size={38} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ClientCommandBar(props: {
  displayName: string | null;
  companyName: string;
  avatarUrl: string | null;
  canMessage: boolean;
  notificationSoundEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  /*
   * On the Messages page the composer is already mounted, so the action just
   * asks it to open. Anywhere else, navigate there first and let the page pick
   * up the request once it mounts.
   */
  const onCompose = () => {
    if (pathname.startsWith("/account/messages")) {
      requestNewMessage();
      return;
    }
    router.push("/account/messages?compose=1");
  };

  return (
    <HeaderPanelsProvider>
      <CommandBarActions {...props} onCompose={onCompose} />
    </HeaderPanelsProvider>
  );
}
