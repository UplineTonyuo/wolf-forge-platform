"use client";

import {
  Bell,
  Building2,
  CreditCard,
  Palette,
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

// Local QA-only preview (WL-2.31); the layout decides server-side whether it shows.
const WHITE_LABEL_NAV_ITEM = { id: "white-label", label: "White Label", route: "/settings/white-label", icon: Palette };

export function SettingsNavigation({ showWhiteLabel = false }: { showWhiteLabel?: boolean }) {
  const pathname = usePathname();
  const items = showWhiteLabel ? [...SETTINGS_NAV_ITEMS, WHITE_LABEL_NAV_ITEM] : SETTINGS_NAV_ITEMS;

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

export function SettingsShell({ children, showWhiteLabel }: { children: React.ReactNode; showWhiteLabel?: boolean }) {
  return (
    <div className={styles.shell}>
      <SettingsNavigation showWhiteLabel={showWhiteLabel} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
