"use client";

import { useEffect, useState, useTransition } from "react";
import { loadIntakeFileInfo, uploadIntakeFile } from "../../app/actions/intake-files";
import { INTAKE_FILE_ACCEPT, INTAKE_FILE_MAX_BYTES } from "../../lib/forms/intake-file";
import styles from "./forms.module.css";

export function IntakeFileField({ assignmentId, fieldKey, label, id, value, required, disabled, onChange, onBusy }: {
  assignmentId: string; fieldKey: string; label: string; id: string; value: string | null;
  required: boolean; disabled: boolean; onChange: (ids: string[]) => void; onBusy: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<{ id: string; name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [request, setRequest] = useState<{ file: File; id: string } | null>(null);
  useEffect(() => {
    if (!value) return;
    let disposed = false;
    void loadIntakeFileInfo(value).then((response) => {
      if (disposed) return;
      if (response.ok) setFile(response.file); else setError(response.error);
    });
    return () => { disposed = true; };
  }, [value]);
  function upload(candidate: File) {
    if (disabled || pending) return;
    if (candidate.size > INTAKE_FILE_MAX_BYTES) { setRequest(null); setError("Choose a file up to 4 MB."); return; }
    const entry = request?.file === candidate ? request : { file: candidate, id: crypto.randomUUID() };
    setRequest(entry);
    onBusy(true); setError(null);
    startTransition(async () => {
      try {
        const data = new FormData(); data.set("file", candidate);
        const response = await uploadIntakeFile({ id: entry.id, assignmentId, fieldKey }, data);
        if (!response.ok) setError(response.error);
        else { setFile(response.file); onChange([response.file.id]); setRequest(null); }
      } catch { setError("Upload could not be confirmed. Retry to check the same file."); }
      finally { onBusy(false); }
    });
  }
  return <div className={styles.intakeFile}>
    <input key={value ?? "empty"} id={id} type="file" name={fieldKey} accept={INTAKE_FILE_ACCEPT} disabled={disabled || pending || Boolean(value)}
      required={required && !value} aria-label={label} onChange={(event) => { const picked = event.target.files?.[0]; if (picked) upload(picked); }} />
    <small>Image or PDF · up to 4 MB</small>
    {pending ? <p role="status">Uploading…</p> : null}
    {value ? <div><a href={`/api/intake-files/${value}`} download>{file?.name ?? "Attached file"}</a>
      <button type="button" disabled={disabled || pending} onClick={() => { onChange([]); setFile(null); setError(null); }}>Remove</button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {error && request ? <button type="button" disabled={disabled || pending} onClick={() => upload(request.file)}>Retry upload</button> : null}
  </div>;
}
