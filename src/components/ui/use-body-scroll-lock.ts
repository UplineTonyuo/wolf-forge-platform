"use client";

import { useEffect } from "react";

let locks = 0;
let previousOverflow = "";

/** Closing animations may overlap another modal's opening. Restore only after the last owner leaves. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) previousOverflow = document.body.style.overflow;
    locks += 1;
    document.body.style.overflow = "hidden";
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
