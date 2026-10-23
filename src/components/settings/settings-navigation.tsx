"use client";

import {
  Bell,
  Building2,
  CreditCard,
  Plug,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./settings-foundation.module.css";

export const SETTINGS_NAV_ITEMS = [
  { id: "general", label: "General", route: "/settings/general", icon: Building2 },
  { id: "team", label: "Team & Access", route: "/settings/team", icon: UsersRound },
  { id: "billing", label: "Billing & Payments", route: "/settings/billing", icon: CreditCard },
  { id: "integrations", label: "Integrations", route: "/settings/integrations", icon: Plug },
  { id: "notifications", label: "Notifications", route: "/settings/notifications", icon: Bell },
  { id: "security", label: "Security", route: "/settings/security", icon: ShieldCheck },
] as const;

export function SettingsNavigation() {
  const pathname = usePathname();
  const items = SETTINGS_NAV_ITEMS;

  return (
    <nav className={styles.navigation} aria-label="Settings sections">
      {items.map((item) => {
        const current = pathname === item.route;
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            href={item.route}
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
  return (
    <div className={styles.shell}>
      <SettingsNavigation />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
