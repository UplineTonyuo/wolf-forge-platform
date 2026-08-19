"use client";

import { MessageSquarePlus, Plus, ShoppingCart } from "lucide-react";
import { useServiceChooser } from "../services/service-chooser-context";
import { HeaderPanel, HeaderPanelAnchor, HeaderPanelTrigger } from "./header-panel";
import { useHeaderPanels } from "./header-panels";

/**
 * The client `+` menu.
 *
 * Only actions a client account can actually perform, each wired to an existing
 * flow. Nothing internal is representable here — there is no "Add client",
 * "Add company" or "Add employee", because this component has no way to express
 * them.
 *
 * It shares the header panel manager with notifications and services, so
 * opening it closes whichever of those was open, and it inherits the same
 * hover, click-to-pin, outside-click and Escape behaviour.
 *
 * "Message Wolf Forge" opens the composer already on the Messages page rather
 * than duplicating it: the request is broadcast and the page's own dialog
 * answers it. That keeps one composer, one validation path and one submit
 * action in the product.
 */
export const OPEN_MESSAGE_COMPOSER_EVENT = "wf:client-new-message";

export function requestNewMessage() {
  window.dispatchEvent(new CustomEvent(OPEN_MESSAGE_COMPOSER_EVENT));
}

export function ClientQuickAction({
  canMessage,
  onNavigateToMessages,
}: {
  /** True when the account holds the Messages module. */
  canMessage: boolean;
  /** Called when the composer is requested from outside the Messages page. */
  onNavigateToMessages: () => void;
}) {
  const panels = useHeaderPanels();
  const chooser = useServiceChooser();

  const canInvest = chooser?.available === true;
  if (!canInvest && !canMessage) return null;

  return (
    <HeaderPanelAnchor>
      <HeaderPanelTrigger panel="quick" label="Quick actions" className="portal-command-plus">
        <Plus aria-hidden={true} />
      </HeaderPanelTrigger>

      <HeaderPanel panel="quick" label="Quick actions">
        <div className="portal-menu-items" role="menu" aria-label="Quick actions">
          {canInvest ? (
            <button
              type="button"
              role="menuitem"
              className="portal-menu-item"
              onClick={() => panels?.pin("services")}
            >
              <ShoppingCart aria-hidden={true} />
              <span>
                <strong>Invest in a service</strong>
                <span>Browse everything Wolf Forge builds</span>
              </span>
            </button>
          ) : null}

          {canMessage ? (
            <button
              type="button"
              role="menuitem"
              className="portal-menu-item"
              onClick={() => {
                panels?.close();
                onNavigateToMessages();
              }}
            >
              <MessageSquarePlus aria-hidden={true} />
              <span>
                <strong>Message Wolf Forge</strong>
                <span>Start a new conversation</span>
              </span>
            </button>
          ) : null}
        </div>
      </HeaderPanel>
    </HeaderPanelAnchor>
  );
}
