"use client";

import { createContext, useContext, useMemo } from "react";
import type { ServiceChooserCatalog } from "../../../domain/client-portal/service-chooser";

/**
 * The client-visible service catalog, loaded once by the layout.
 *
 * This no longer owns whether the chooser is open — that moved to the header
 * panel manager, which is the only thing that can guarantee a single floating
 * panel at a time. What is left is the catalog itself, and whether the account
 * holds the Store module at all.
 */
type ServiceChooserValue = {
  catalog: ServiceChooserCatalog;
  /** False when the account has no Store module, so triggers can hide. */
  available: boolean;
};

const ServiceChooserContext = createContext<ServiceChooserValue | null>(null);

export function ServiceChooserProvider({
  catalog,
  available,
  children,
}: {
  catalog: ServiceChooserCatalog;
  available: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ catalog, available }), [catalog, available]);

  return (
    <ServiceChooserContext.Provider value={value}>{children}</ServiceChooserContext.Provider>
  );
}

/**
 * Returns null outside the provider rather than throwing, so a trigger can be
 * rendered unconditionally and simply not offer the action when the account has
 * no Store module.
 */
export function useServiceChooser(): ServiceChooserValue | null {
  return useContext(ServiceChooserContext);
}
