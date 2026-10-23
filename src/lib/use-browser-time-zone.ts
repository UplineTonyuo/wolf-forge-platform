"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const browserSnapshot = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverSnapshot = () => "UTC";

export function useBrowserTimeZone(): string {
  // Match SSR during hydration, then adopt the viewer's time zone.
  return useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
}
