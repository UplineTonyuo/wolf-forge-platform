"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/account/tickets", label: "Tickets" },
  { href: "/account/forms", label: "Forms" },
  { href: "/account/subscriptions", label: "Subscriptions" },
  { href: "/account/invoices", label: "Invoices" },
] as const;

export function ClientAccountNavigation() {
  const pathname = usePathname();

  return (
    <nav className="client-account-navigation" aria-label="Client account">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>{item.label}</Link>;
      })}
    </nav>
  );
}
