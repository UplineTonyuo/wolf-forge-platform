"use client";

import { usePathname } from "next/navigation";
import { ClientRouteSkeleton } from "../../components/account/client-route-skeleton";

export default function Loading() {
  return <ClientRouteSkeleton pathname={usePathname()} />;
}
