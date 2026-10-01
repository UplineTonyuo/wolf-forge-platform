"use client";

import { usePathname } from "next/navigation";
import { RouteSkeleton } from "../../components/shell/route-skeletons";

/*
 * One Suspense boundary for every internal route below InternalShell, for
 * navigation that does not go through the sidebar (links, search, reloads).
 * It renders the destination-shaped skeleton for the committed pathname.
 * Routes with their own loading.tsx (Operations, All Conversations) still win.
 */
export default function InternalLoading() {
  return <RouteSkeleton pathname={usePathname()} />;
}
