"use client";

import {
  Children, Fragment, cloneElement, createContext, isValidElement,
  useContext, useEffect, useState, type CSSProperties, type ReactNode,
} from "react";
import type { RuntimeWhiteLabelConfiguration } from "../../domain/white-label/publication";
import { decodeRuntimeWhiteLabelConfiguration, WHITE_LABEL_PUBLICATION_CONTRACT_VERSION } from "../../domain/white-label/publication";
import { tenantBranding } from "./tenant-branding";
import { BRANDING_REFRESH_INTERVAL_MS } from "../../domain/background-polling";

export type RuntimeBrandingReader = () => Promise<RuntimeWhiteLabelConfiguration>;
export type TenantBrandingState = { branding: ReturnType<typeof tenantBranding>; unavailable: boolean };
const BrandingContext = createContext<TenantBrandingState | null>(null);

export async function readRuntimeBranding(actorId: string): Promise<RuntimeWhiteLabelConfiguration> {
  const response = await fetch("/api/white-label/runtime", {
    cache: "no-store", credentials: "same-origin", redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || response.headers.get("x-wf-branding-actor") !== actorId) {
    throw new Error("Workspace branding is unavailable.");
  }
  return decodeRuntimeWhiteLabelConfiguration(await response.json());
}

export function TenantBrandingProvider({ value, children }: { value: TenantBrandingState; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

type ScopeProps = {
  className?: string; style?: CSSProperties; children?: ReactNode;
  "data-branding-tenant"?: string; "data-branding-revision"?: number; "data-branding-contract"?: string;
};

/** Copy context onto existing portal roots without inserting a focus/positioning wrapper. */
export function TenantBrandingScope({ children }: { children: ReactNode }) {
  const branding = useContext(BrandingContext)?.branding;
  function scope(child: ReactNode): ReactNode {
    if (!isValidElement<ScopeProps>(child)) return child;
    if (child.type === Fragment) return cloneElement(child, { children: Children.map(child.props.children, scope) });
    if (!branding || typeof child.type !== "string") return child;
    return cloneElement(child, {
      className: `${child.props.className ?? ""} tenant-workspace`.trim(),
      style: { ...branding.style, ...child.props.style },
      "data-branding-tenant": branding.tenantId,
      "data-branding-revision": branding.revision,
      "data-branding-contract": WHITE_LABEL_PUBLICATION_CONTRACT_VERSION,
    });
  }
  return Children.map(children, scope);
}

function scopeOf(configuration: RuntimeWhiteLabelConfiguration) {
  return configuration.kind === "published"
    ? { tenantId: configuration.configuration.tenantId, revision: configuration.configuration.publicationRevision }
    : { tenantId: configuration.tenantId, revision: configuration.publicationRevision };
}

export function useRuntimeBranding(
  initial: RuntimeWhiteLabelConfiguration | null | undefined,
  actorScope: string,
  enabled: boolean,
  readConfiguration?: RuntimeBrandingReader,
): TenantBrandingState {
  const [readState, setReadState] = useState<{
    initial: RuntimeWhiteLabelConfiguration | null; actorScope: string;
    configuration?: RuntimeWhiteLabelConfiguration; unavailable: boolean;
    tenantId?: string; revision: number;
  } | null>(null);
  const current = readState?.actorScope === actorScope && (
    readState.initial === initial || (initial && readState.tenantId === scopeOf(initial).tenantId &&
      readState.revision >= scopeOf(initial).revision)
  ) ? readState : null;
  const unavailable = enabled && (current?.unavailable ?? initial === null);
  const configuration = current ? current.configuration : initial;
  const branding = enabled && !unavailable && configuration !== null ? tenantBranding(configuration) : null;

  useEffect(() => {
    if (!enabled || initial === undefined) return;
    const seed = initial;
    const reader = readConfiguration ?? (() => readRuntimeBranding(actorScope.split(":")[0]!));
    let selectedTenantId = seed ? scopeOf(seed).tenantId : undefined;
    let latestRevision = seed ? scopeOf(seed).revision : 0;
    let disposed = false;
    let inFlight = false;
    let resumePending = false;

    async function refresh(resume = false) {
      if (disposed || document.hidden) return;
      if (inFlight) {
        if (resume) resumePending = true;
        return;
      }
      inFlight = true;
      try {
        const result = await reader();
        if (disposed) return;
        tenantBranding(result);
        const received = scopeOf(result);
        if (selectedTenantId && received.tenantId !== selectedTenantId) throw new Error("Workspace scope changed.");
        if (received.revision < latestRevision) return;
        selectedTenantId = received.tenantId;
        latestRevision = received.revision;
        setReadState((previous) => {
          if (previous?.actorScope === actorScope && previous.tenantId === received.tenantId &&
              previous.revision > received.revision) return previous;
          return { initial: seed, actorScope, configuration: result, unavailable: false,
            tenantId: received.tenantId, revision: received.revision };
        });
      } catch {
        if (!disposed) setReadState((previous) => ({ initial: seed, actorScope, unavailable: true,
          tenantId: selectedTenantId, revision: previous?.actorScope === actorScope && previous.tenantId === selectedTenantId
            ? Math.max(previous.revision, latestRevision) : latestRevision,
        }));
      } finally {
        inFlight = false;
        if (!disposed && resumePending) {
          resumePending = false;
          if (!document.hidden) void refresh();
        }
      }
    }

    const onReturn = () => { if (!document.hidden) void refresh(true); else resumePending = false; };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, BRANDING_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      disposed = true;
      resumePending = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [initial, actorScope, enabled, readConfiguration]);

  return { branding, unavailable };
}
