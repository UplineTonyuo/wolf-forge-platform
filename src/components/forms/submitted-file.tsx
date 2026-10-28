"use client";
import { useEffect, useState } from "react";
import { loadIntakeFileInfo } from "../../app/actions/intake-files";

export function SubmittedFile({ id }: { id: string }) {
  return <SubmittedFileInfo key={id} id={id} />;
}

function SubmittedFileInfo({ id }: { id: string }) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void loadIntakeFileInfo(id).then((result) => {
      if (disposed) return;
      if (result.ok) setName(result.file.name); else setError(result.error);
    }).catch(() => { if (!disposed) setError("This attachment is unavailable. Reload and try again."); });
    return () => { disposed = true; };
  }, [id]);
  return error ? <span role="status">{error}</span> : name ? <a href={`/api/intake-files/${id}`} download>{name}</a> : <span role="status">Loading attachment…</span>;
}
