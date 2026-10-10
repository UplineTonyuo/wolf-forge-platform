"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const TICKET_UNAVAILABLE_EVENT = "wolf-forge:ticket-unavailable";

export function notifyTicketAccessUnavailable(ticketId?: string) {
  window.dispatchEvent(new CustomEvent(TICKET_UNAVAILABLE_EVENT, { detail: ticketId }));
}

const TicketUnavailableContext = createContext<(() => void) | undefined>(undefined);

export function useTicketUnavailableBoundary() {
  return useContext(TicketUnavailableContext);
}

export function TicketAccessBoundary({ children, ticketId, listenForModuleDenial = false }: {
  children: ReactNode;
  ticketId?: string;
  listenForModuleDenial?: boolean;
}) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const deny = (event: Event) => {
      const deniedId = (event as CustomEvent<string | undefined>).detail;
      if ((ticketId && deniedId === ticketId) || (listenForModuleDenial && !deniedId)) {
        setUnavailable(true);
      }
    };
    window.addEventListener(TICKET_UNAVAILABLE_EVENT, deny);
    return () => window.removeEventListener(TICKET_UNAVAILABLE_EVENT, deny);
  }, [ticketId, listenForModuleDenial]);
  if (unavailable) return <p role="alert">This conversation is unavailable.</p>;
  return (
    <TicketUnavailableContext.Provider value={() => setUnavailable(true)}>
      {children}
    </TicketUnavailableContext.Provider>
  );
}
