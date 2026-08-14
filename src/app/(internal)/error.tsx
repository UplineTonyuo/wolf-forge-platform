"use client";

import { useEffect } from "react";
import { DataError } from "../../components/ui/list-states";
import { PageFrame } from "../../components/ui/page-frame";

export default function InternalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <PageFrame title="Unable to load"><DataError /><button className="button-secondary error-retry" onClick={reset}>Try again</button></PageFrame>;
}
