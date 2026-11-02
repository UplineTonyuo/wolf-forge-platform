"use client";

import { History, Info, Paperclip } from "lucide-react";
import { RouteTransitionLink as Link } from "../shell/route-transition";
import { usePathname } from "next/navigation";
import { startTransition } from "react";
import { useOrderSectionTransition, type OrderSection } from "./order-section-transition";
import styles from "./project-detail.module.css";

/** Details / Files / History are real routes sharing this Order's layout — not anchors. */
export function OrderTabs({ orderId }: { orderId: string }) {
  const pathname = usePathname();
  const transition = useOrderSectionTransition();

  const items = [
    { href: `/orders/${orderId}`, label: "Details", icon: Info },
    { href: `/orders/${orderId}/files`, label: "Files", icon: Paperclip },
    { href: `/orders/${orderId}/history`, label: "History", icon: History },
  ];

  return (
    <div className={styles.tabs}>
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            scroll={false}
            onNavigate={() => startTransition(() => transition?.begin(active ? null : item.label.toLowerCase() as OrderSection))}
            aria-busy={transition?.section === item.label.toLowerCase() || undefined}
            className={active ? styles.tabActive : styles.tab}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
