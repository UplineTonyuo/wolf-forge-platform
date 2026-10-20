"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { clearDeviceDrafts, prepareDraftSession, revokeTicketDrafts, type DraftSession } from "../../lib/tickets/client-draft-store";
import { TICKET_UNAVAILABLE_EVENT } from "./ticket-access-boundary";

type DraftContext = { enabled: boolean; session: DraftSession | null; error: boolean };
const Context = createContext<DraftContext>({ enabled: false, session: null, error: false });
export const useClientDraftSession = () => useContext(Context);

export function ClientDraftProvider({ owner, children }: { owner: string | null; children: ReactNode }) {
  const [state, setState] = useState<DraftContext>({ enabled: Boolean(owner), session: null, error: false });
  useEffect(() => {
    if (!owner) return;
    let canceled = false;
    prepareDraftSession(owner).then(
      (session) => { if (!canceled) setState({ enabled: true, session, error: false }); },
      () => { if (!canceled) setState({ enabled: true, session: null, error: true }); },
    );
    return () => { canceled = true; };
  }, [owner]);
  useEffect(() => {
    if (!state.session) return;
    const session = state.session;
    const revoke = (event: Event) => {
      const ticketId = (event as CustomEvent<string | undefined>).detail;
      void revokeTicketDrafts(session, ticketId).finally(() => setState({ enabled: true, session: null, error: true })).catch(() => undefined);
    };
    window.addEventListener(TICKET_UNAVAILABLE_EVENT, revoke);
    return () => window.removeEventListener(TICKET_UNAVAILABLE_EVENT, revoke);
  }, [state.session]);
  const value = !owner ? { enabled: false, session: null, error: false }
    : state.session?.owner === owner ? state : { enabled: true, session: null, error: state.error };
  return <Context.Provider key={owner} value={value}>{children}</Context.Provider>;
}

export function ClientDraftSignOut({ action, children }: { action: () => Promise<void>; children: ReactNode }) {
  const context = useClientDraftSession();
  return <form action={async () => {
    try { if (context.enabled) await clearDeviceDrafts(); }
    finally { await action(); }
  }}>{children}</form>;
}
