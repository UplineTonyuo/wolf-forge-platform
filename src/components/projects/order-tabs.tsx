"use client";

import { History, Info, Paperclip } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./project-detail.module.css";

/** Details / Files / History are real routes sharing this Order's layout — not anchors. */
export function OrderTabs({ orderId }: { orderId: string }) {
  const pathname = usePathname();

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
