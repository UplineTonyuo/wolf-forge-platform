"use client";

import {
  ListChecks,
  Menu,
  X,
  FileText,
  FolderKanban,
  FormInput,
  HandCoins,
  LayoutDashboard,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  TicketCheck,
  UsersRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  ComponentType,
  MouseEvent,
  ReactNode,
} from "react";
import type { InternalUser } from "../../lib/supabase/next-server";
import { navigationForModules, routeIsCurrent } from "./nav-registry";
import { WolfForgeMark } from "./wolf-forge-mark";
import { WorkspaceCommandBar } from "./workspace-command-bar";
import { AccountMenu } from "./account-menu";
import { TeamPresenceProvider } from "../team/team-presence-provider";

const navigationIcons: Record<string, ComponentType<{ "aria-hidden": true }>> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  tickets: TicketCheck,
  clients: UsersRound,
  todo: ListChecks,
  invoices: ReceiptText,
  subscriptions: HandCoins,
  coupons: Tags,
  investment_intent: Sparkles,
  services: Wrench,
  forms: FormInput,
  team: ShieldCheck,
  settings: Settings,
};

type RouteTransitionPhase =
  | "idle"
  | "vacuum"
  | "enter";

function SidebarLink({
  id,
  label,
  route,
  active,
  transitioning,
  onNavigate,
}: {
  id: string;
  label: string;
  route: string;
  active: boolean;
  transitioning: boolean;
  onNavigate: (
    route: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) => void;
}) {
  const Icon =
    navigationIcons[id] ?? FileText;

  const className = [
    "sidebar-link",
    active ? "is-active" : "",
    transitioning
      ? "is-transition-target"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      className={className}
      href={route}
      aria-current={
        active ? "page" : undefined
      }
      onClick={(event) =>
        onNavigate(route, event)
      }
    >
      <Icon aria-hidden={true} />
      <span>{label}</span>
    </Link>
  );
}

export function InternalShell({
  user,
  children,
}: {
  user: InternalUser;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const navigationCategories = navigationForModules(user.modules);
  const mobileDrawerRef = useRef<HTMLDialogElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) mobileDrawerRef.current?.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const mainRef =
    useRef<HTMLElement>(null);

  const pendingRouteRef =
    useRef<string | null>(null);

  const exitTimerRef =
    useRef<
      ReturnType<typeof setTimeout> | null
    >(null);

  const frameRefs =
    useRef<number[]>([]);

  const [
    transitionPhase,
    setTransitionPhase,
  ] =
    useState<RouteTransitionPhase>(
      "idle",
    );

  const [
    transitionTarget,
    setTransitionTarget,
  ] =
    useState<string | null>(null);


  useEffect(() => {
    return () => {
      if (exitTimerRef.current) {
        clearTimeout(
          exitTimerRef.current,
        );
      }

      frameRefs.current.forEach(
        (frame) =>
          window.cancelAnimationFrame(
            frame,
          ),
      );
    };
  }, []);


  useEffect(() => {
    const pending =
      pendingRouteRef.current;

    if (!pending) {
      return;
    }

    if (
      !routeIsCurrent(
        pending,
        pathname,
      )
    ) {
      return;
    }

    if (exitTimerRef.current) {
      clearTimeout(
        exitTimerRef.current,
      );

      exitTimerRef.current = null;
    }

    /*
     * The new route has committed.
     *
     * Keep it hidden for one paint,
     * then release it into the normal
     * workspace position.
     */
    setTransitionPhase("enter");

    frameRefs.current.forEach(
      (frame) =>
        window.cancelAnimationFrame(
          frame,
        ),
    );

    frameRefs.current = [];

    const firstFrame =
      window.requestAnimationFrame(
        () => {
          const secondFrame =
            window.requestAnimationFrame(
              () => {
                setTransitionPhase(
                  "idle",
                );

                setTransitionTarget(
                  null,
                );

                pendingRouteRef.current =
                  null;

                frameRefs.current = [];
              },
            );

          frameRefs.current = [
            secondFrame,
          ];
        },
      );

    frameRefs.current = [
      firstFrame,
    ];
  }, [pathname]);


  function handleSidebarNavigate(
    route: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) {
    /*
     * Preserve normal browser behavior
     * for new tabs / modified clicks.
     */
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (
      routeIsCurrent(
        route,
        pathname,
      )
    ) {
      event.preventDefault();
      return;
    }

    if (
      transitionPhase !== "idle"
    ) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    /*
     * Respect reduced-motion users and
     * navigate immediately.
     */
    if (
      window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
    ) {
      router.push(route);
      return;
    }

    const main =
      mainRef.current;

    if (!main) {
      router.push(route);
      return;
    }

    /*
     * Warm the destination while the
     * outgoing animation is playing.
     */
    router.prefetch(route);

    const destinationRect =
      event.currentTarget.getBoundingClientRect();

    const mainRect =
      main.getBoundingClientRect();

    const destinationCenterY =
      destinationRect.top +
      destinationRect.height / 2;

    /*
     * Make the page collapse toward the
     * vertical position of the sidebar
     * item that was clicked.
     */
    const rawOriginY =
      destinationCenterY -
      mainRect.top;

    const safeMinimum = 24;

    const safeMaximum =
      Math.max(
        safeMinimum,
        mainRect.height - 24,
      );

    const originY =
      Math.min(
        Math.max(
          rawOriginY,
          safeMinimum,
        ),
        safeMaximum,
      );

    main.style.setProperty(
      "--wf-route-origin-y",
      `${originY}px`,
    );

    pendingRouteRef.current =
      route;

    setTransitionTarget(route);

    setTransitionPhase(
      "vacuum",
    );

    const navigationFrame =
      window.requestAnimationFrame(
        () => {
          router.push(route);
        },
      );

    frameRefs.current.push(
      navigationFrame,
    );
  }


  const stageClassName = [
    "workspace-route-stage",

    transitionPhase === "vacuum"
      ? "is-vacuuming"
      : "",

    transitionPhase === "enter"
      ? "is-entering"
      : "",
  ]
    .filter(Boolean)
    .join(" ");


  function renderNavigation(mobile = false) {
    return (
      <nav className="sidebar-navigation" aria-label={mobile ? "Mobile primary" : "Primary"}>
        {navigationCategories.map((category) => (
          <section className="sidebar-section" key={category.id} aria-labelledby={`${mobile ? "mobile-" : ""}nav-${category.id}`}>
            <h2 id={`${mobile ? "mobile-" : ""}nav-${category.id}`}>{category.label}</h2>
            <div className="sidebar-links">
              {category.items.map((item) => (
                <SidebarLink
                  key={item.id}
                  {...item}
                  active={routeIsCurrent(item.route, transitionTarget ?? pathname)}
                  transitioning={transitionTarget === item.route}
                  onNavigate={mobile ? () => mobileDrawerRef.current?.close() : handleSidebarNavigate}
                />
              ))}
            </div>
          </section>
        ))}
      </nav>
    );
  }

  return (
    <TeamPresenceProvider enabled={user.teamMessaging.use}>
      <div className="internal-app">
      <a
        className="skip-link"
        href="#main-content"
      >
        Skip to content
      </a>

      <aside className="app-sidebar">
        <div
          className="sidebar-brand is-mark-only"
          aria-label="Wolf Forge"
        >
          <WolfForgeMark />
        </div>

        {renderNavigation()}
      </aside>

      <dialog
        ref={mobileDrawerRef}
        id="mobile-navigation"
        className="mobile-nav-drawer"
        aria-label="Wolf Forge navigation"
        onClose={() => setMobileOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) mobileDrawerRef.current?.close();
        }}
      >
        <div className="mobile-nav-header">
          <WolfForgeMark />
          <strong>Wolf Forge</strong>
          <button type="button" aria-label="Close navigation" onClick={() => mobileDrawerRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </div>
        {renderNavigation(true)}
        <AccountMenu user={user} sidebar />
      </dialog>

      <div
        id="main-content"
        className="workspace"
      >
        <WorkspaceCommandBar
          user={user}
          mobileNavigation={
            <button
              type="button"
              className="mobile-nav-trigger"
              aria-label="Open navigation"
              aria-controls="mobile-navigation"
              aria-haspopup="dialog"
              aria-expanded={mobileOpen}
              onClick={() => {
                mobileDrawerRef.current?.showModal();
                setMobileOpen(true);
              }}
            >
              <Menu aria-hidden="true" />
            </button>
          }
        />

        <main
          ref={mainRef}
          className={
            stageClassName
          }
        >
          {children}
        </main>
      </div>
      </div>
    </TeamPresenceProvider>
  );
}
