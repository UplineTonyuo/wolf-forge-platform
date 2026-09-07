"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const OPERATIONS_TABS = [
  { id: "tasks", label: "Tasks", route: "/todo" },
  { id: "departments", label: "Departments", route: "/todo/departments" },
] as const;

/**
 * Root-level Tasks is only ever exactly `/todo`; Departments also owns every
 * `/todo/departments/...` drill-down (e.g. Podcast SEO), so it stays active
 * while browsing inside a department.
 */
function tabIsActive(route: string, pathname: string): boolean {
  if (route === "/todo") return pathname === "/todo";
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function OperationsTabs() {
  const pathname = usePathname();

  return (
    <nav className="operations-tabs" aria-label="Operations sections">
      {OPERATIONS_TABS.map((tab) => {
        const active = tabIsActive(tab.route, pathname);
        return (
          <Link
            key={tab.id}
            href={tab.route}
            className="operations-tab"
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
