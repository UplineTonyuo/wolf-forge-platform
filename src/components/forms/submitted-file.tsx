"use client";
import { useEffect, useState } from "react";
import { loadIntakeFileInfo } from "../../app/actions/intake-files";

export function SubmittedFile({ id }: { id: string }) {
  const [name, setName] = useState("Attached file");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void loadIntakeFileInfo(id).then((result) => {
      if (disposed) return;
      if (result.ok) setName(result.file.name); else setError(result.error);
    });
    return () => { disposed = true; };
  }, [id]);
  return error ? <span role="status">{error}</span> : <a href={`/api/intake-files/${id}`} download>{name}</a>;
}
