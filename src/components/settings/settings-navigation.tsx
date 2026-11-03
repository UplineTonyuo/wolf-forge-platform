"use client";

import {
  Bell,
  Building2,
  CreditCard,
  Plug,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { RouteTransitionLink as Link } from "../shell/route-transition";
import { usePathname } from "next/navigation";
import { createContext, startTransition, useContext, useOptimistic } from "react";
import { SettingsSectionSkeleton, type SettingsSection } from "../shell/route-skeletons";
import styles from "./settings-foundation.module.css";

export const SETTINGS_NAV_ITEMS = [
  { id: "general", label: "General", route: "/settings/general", icon: Building2 },
  { id: "team", label: "Team & Access", route: "/settings/team", icon: UsersRound },
  { id: "billing", label: "Billing & Payments", route: "/settings/billing", icon: CreditCard },
  { id: "integrations", label: "Integrations", route: "/settings/integrations", icon: Plug },
  { id: "notifications", label: "Notifications", route: "/settings/notifications", icon: Bell },
  { id: "security", label: "Security", route: "/settings/security", icon: ShieldCheck },
] as const;

const SettingsTransition = createContext<{ route: string | null; begin: (route: string | null) => void } | null>(null);

export function SettingsNavigation() {
  const pathname = usePathname();
  const transition = useContext(SettingsTransition);
  const items = SETTINGS_NAV_ITEMS;

  return (
    <nav className={styles.navigation} aria-label="Settings sections">
      {items.map((item) => {
        const current = (transition?.route ?? pathname) === item.route;
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={item.route}
            data-route-skeleton="off"
            onNavigate={() => startTransition(() => transition?.begin(pathname === item.route ? null : item.route))}
            className={styles.navigationLink}
            aria-current={current ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const [route, begin] = useOptimistic<string | null>(null);
  return (
    <SettingsTransition.Provider value={{ route, begin }}><div className={styles.shell}>
      <SettingsNavigation />
      <div className={styles.content}>
        {route ? <SettingsSectionSkeleton section={route.split("/")[2] as SettingsSection} /> : null}
        <div hidden={route !== null} aria-busy={route !== null}>{children}</div>
      </div>
    </div></SettingsTransition.Provider>
  );
}
