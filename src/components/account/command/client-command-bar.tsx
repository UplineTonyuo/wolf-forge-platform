"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { AccountAvatar } from "../../ui/account-avatar";
import { ClientCartPanel } from "../cart/client-cart-panel";
import { ClientNotificationBell } from "../client-notification-bell";
import { portalTitleForPath } from "../portal-nav-registry";
import { ClientCalendarAction } from "./client-calendar-action";
import { ClientQuickAction, requestNewMessage } from "./client-quick-action";
import { ClientSearch } from "./client-search";
import { HeaderPanelsProvider, useHeaderPanels } from "./header-panels";
import { usePortalDrawer } from "./portal-drawer";

/**
 * The client command bar — one row at every width.
 *
 * The same family as the internal WorkspaceCommandBar — search, then a row of
 * actions — without inheriting any of its internal-only ones. It is a distinct
 * component rather than a shared one for the same reason the rails are
 * distinct: nothing internal should be reachable from client code by changing a
 * flag.
 *
 * Below 768px it is the whole header, and it reads:
 *
 *   ☰   Dashboard              ⌕  Cart  Calendar  Notifications
 *
 * The search control morphs the row in place — the input takes it, the title and
 * the utility icons step aside — so the header never grows a second line.
 * Above that the rail is permanent, so the drawer toggle and the page title are
 * not rendered and the row is the search field plus the utility cluster it has
 * always been.
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
  const drawer = usePortalDrawer();
  const pathname = usePathname();

  /*
   * Mobile search mode. Owned here rather than inside ClientSearch because the
   * whole row changes with it — the title and the utility icons step aside —
   * and the row is this component's markup.
   */
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div
      className="portal-command-bar"
      aria-label="Workspace controls"
      data-search-open={searchOpen ? "true" : "false"}
    >
      <button
        type="button"
        className="portal-drawer-toggle"
        aria-expanded={drawer?.open ?? false}
        aria-controls="portal-navigation"
        onClick={() => drawer?.toggle()}
      >
        {drawer?.open ? <X aria-hidden={true} /> : <Menu aria-hidden={true} />}
        <span className="sr-only">{drawer?.open ? "Close menu" : "Open menu"}</span>
      </button>

      <span className="portal-command-title">{portalTitleForPath(pathname)}</span>

      <ClientSearch mobileOpen={searchOpen} onMobileOpenChange={setSearchOpen} />

      <div className="portal-command-actions">
        <ClientCartPanel />

        <ClientCalendarAction />

        <ClientNotificationBell soundEnabled={notificationSoundEnabled} inCommandBar />

        {/*
         * The + and the avatar read as one distinct pair — the account's
         * creation and identity controls — separated from the utility icons by
         * a larger gap. The + already carries the new-message action ("Message
         * Wolf Forge"), so there is no standalone compose icon in the header.
         *
         * On mobile the pair breaks up: the + leaves the row for a bottom-right
         * floating trigger (see the stylesheet) rather than crowding an already
         * dense strip, and the avatar is not rendered at all — Profile is one
         * tap away in the navigation drawer.
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
