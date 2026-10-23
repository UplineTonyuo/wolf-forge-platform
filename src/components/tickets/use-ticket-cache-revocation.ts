"use client";

import { useEffect, useRef, type RefObject } from "react";
import { TICKET_UNAVAILABLE_EVENT } from "./ticket-access-boundary";

/** Invalidate downloaded Ticket projections before a possibly queued route refresh. */
export function useTicketCacheRevocation(invalidate: () => void, generation?: RefObject<number>) {
  const localGeneration = useRef(0);
  const epoch = generation ?? localGeneration;
  const invalidateRef = useRef(invalidate);
  useEffect(() => { invalidateRef.current = invalidate; }, [invalidate]);
  useEffect(() => {
    const deny = () => {
      epoch.current += 1;
      invalidateRef.current();
    };
    window.addEventListener(TICKET_UNAVAILABLE_EVENT, deny);
    return () => window.removeEventListener(TICKET_UNAVAILABLE_EVENT, deny);
  }, [epoch]);
}
