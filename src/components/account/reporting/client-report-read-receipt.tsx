"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { markClientReportReadAction } from "../../../app/actions/reporting";

/**
 * Opening the native detail is the deliberate read event. The write stays
 * profile-scoped in the database; refreshing after it lands updates the shell's
 * unread badge as well as the list the client returns to.
 */
export function ClientReportReadReceipt({ reportId }: { reportId: string }) {
  const router = useRouter();
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;

    void markClientReportReadAction({ reportId }).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [reportId, router]);

  return null;
}
