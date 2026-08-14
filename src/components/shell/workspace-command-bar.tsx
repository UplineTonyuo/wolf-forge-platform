"use client";

import { GlobalSearch } from "./global-search";

import {
  Bell,
  Images,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createPortal,
} from "react-dom";
import {
  getWalletNotificationsAction,
  type WalletNotificationItem,
} from "../../app/actions/notifications";
import type {
  InternalUser,
} from "../../lib/supabase/next-server";
import {
  AccountMenu,
} from "./account-menu";
import {
  WorkspaceQuickAction,
} from "./workspace-quick-action";

function formatActivityTime(
  value: string,
) {
  const date = new Date(value);

  return new Intl.DateTimeFormat(
    undefined,
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

type NotificationPosition = {
  top: number;
  right: number;
};

export function WorkspaceCommandBar({
  user,
}: {
  user: InternalUser;
}) {
  const triggerRef =
    useRef<HTMLButtonElement>(null);

  const panelRef =
    useRef<HTMLElement>(null);

  const [
    mounted,
    setMounted,
  ] = useState(false);

  const [
    notifications,
    setNotifications,
  ] = useState<
    WalletNotificationItem[]
  >([]);

  const [
    notificationsOpen,
    setNotificationsOpen,
  ] = useState(false);

  const [
    notificationsLoading,
    setNotificationsLoading,
  ] = useState(false);

  const [
    notificationsError,
    setNotificationsError,
  ] = useState<string | null>(
    null,
  );

  const [
    notificationPosition,
    setNotificationPosition,
  ] =
    useState<NotificationPosition>({
      top: 76,
      right: 20,
    });

  const loadNotifications =
    useCallback(async () => {
      setNotificationsLoading(true);

      const result =
        await getWalletNotificationsAction();

      if (result.ok) {
        setNotifications(
          result.notifications,
        );

        setNotificationsError(null);
      } else {
        setNotificationsError(
          result.error,
        );
      }

      setNotificationsLoading(false);
    }, []);

  const updatePanelPosition =
    useCallback(() => {
      const trigger =
        triggerRef.current;

      if (!trigger) {
        return;
      }

      const rect =
        trigger.getBoundingClientRect();

      const right =
        Math.max(
          12,
          window.innerWidth -
            rect.right,
        );

      setNotificationPosition({
        top: rect.bottom + 10,
        right,
      });
    }, []);

  useEffect(() => {
    setMounted(true);

    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (!notificationsOpen) {
      return;
    }

    updatePanelPosition();

    const handleResize = () => {
      updatePanelPosition();
    };

    const handleScroll = () => {
      updatePanelPosition();
    };

    window.addEventListener(
      "resize",
      handleResize,
    );

    window.addEventListener(
      "scroll",
      handleScroll,
      true,
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize,
      );

      window.removeEventListener(
        "scroll",
        handleScroll,
        true,
      );
    };
  }, [
    notificationsOpen,
    updatePanelPosition,
  ]);

  useEffect(() => {
    const closeForQuickAction = () => {
      setNotificationsOpen(false);
    };

    window.addEventListener(
      "wf:quick-action-open",
      closeForQuickAction,
    );

    return () => {
      window.removeEventListener(
        "wf:quick-action-open",
        closeForQuickAction,
      );
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (
      event: PointerEvent,
    ) => {
      if (!notificationsOpen) {
        return;
      }

      const target =
        event.target as Node;

      const trigger =
        triggerRef.current;

      const panel =
        panelRef.current;

      if (
        trigger?.contains(target) ||
        panel?.contains(target)
      ) {
        return;
      }

      setNotificationsOpen(false);
    };

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        setNotificationsOpen(
          false,
        );
      }
    };

    document.addEventListener(
      "pointerdown",
      handlePointerDown,
    );

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown,
      );

      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [notificationsOpen]);

  const toggleNotifications =
    async () => {
      if (notificationsOpen) {
        setNotificationsOpen(false);
        return;
      }

      updatePanelPosition();

      setNotificationsOpen(true);

      await loadNotifications();
    };

  const notificationPanel = (
    <section
      ref={panelRef}
      className={
        notificationsOpen
          ? "workspace-notification-portal is-open"
          : "workspace-notification-portal"
      }
      style={{
        top:
          notificationPosition.top,
        right:
          notificationPosition.right,
      }}
      aria-hidden={
        !notificationsOpen
      }
      aria-label="Notifications"
    >
      <header className="workspace-notification-header">
        <div>
          <strong>
            Notifications
          </strong>

          <span>
            Recent wallet activity
          </span>
        </div>

        {notificationsLoading ? (
          <span className="workspace-notification-refreshing">
            Refreshing...
          </span>
        ) : notifications.length ? (
          <span className="workspace-notification-count">
            {notifications.length}
          </span>
        ) : null}
      </header>

      <div className="workspace-notification-list">
        {notificationsError ? (
          <div className="workspace-notification-empty">
            {notificationsError}
          </div>
        ) : notifications.length ===
            0 &&
          !notificationsLoading ? (
          <div className="workspace-notification-empty">
            No wallet activity yet.
          </div>
        ) : (
          notifications.map(
            (notification) => (
              <Link
                key={
                  notification.id
                }
                href={
                  notification.href
                }
                className="workspace-notification-item"
                onClick={() =>
                  setNotificationsOpen(
                    false,
                  )
                }
              >
                <span
                  className={
                    notification.kind ===
                    "credit"
                      ? "workspace-notification-kind is-credit"
                      : "workspace-notification-kind is-debit"
                  }
                >
                  {notification.kind ===
                  "credit" ? (
                    <Plus
                      aria-hidden="true"
                    />
                  ) : (
                    <Minus
                      aria-hidden="true"
                    />
                  )}
                </span>

                <span className="workspace-notification-copy">
                  <strong>
                    {
                      notification.title
                    }
                  </strong>

                  <span className="workspace-notification-body">
                    {
                      notification.body
                    }
                  </span>

                  {notification.reason ? (
                    <span className="workspace-notification-reason">
                      Reason:{" "}
                      {
                        notification.reason
                      }
                    </span>
                  ) : null}

                  <time
                    dateTime={
                      notification.createdAt
                    }
                  >
                    {formatActivityTime(
                      notification.createdAt,
                    )}
                  </time>
                </span>
              </Link>
            ),
          )
        )}
      </div>
    </section>
  );

  return (
    <>
      <div
        className="workspace-command-bar"
        aria-label="Workspace controls"
      >
        <GlobalSearch />
        <div className="workspace-command-shortcuts">
          <button
            className="workspace-command-button"
            type="button"
            aria-label="Gallery"
            title="Gallery"
          >
            <Images
              aria-hidden="true"
            />
          </button>

          <button
            ref={triggerRef}
            className={
              notificationsOpen
                ? "workspace-command-button workspace-notification-trigger is-open"
                : "workspace-command-button workspace-notification-trigger"
            }
            type="button"
            aria-label="Notifications"
            title="Notifications"
            aria-expanded={
              notificationsOpen
            }
            aria-haspopup="dialog"
            onClick={
              toggleNotifications
            }
          >
            <Bell
              aria-hidden="true"
            />

            {notifications.length >
            0 ? (
              <span
                className="workspace-notification-dot"
                aria-hidden="true"
              />
            ) : null}
          </button>

          <WorkspaceQuickAction
            user={user}
          />
        </div>

        <div className="workspace-command-profile">
          <AccountMenu
            user={user}
          />
        </div>
      </div>

      {mounted
        ? createPortal(
            notificationPanel,
            document.body,
          )
        : null}
    </>
  );
}