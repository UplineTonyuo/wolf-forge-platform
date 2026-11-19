"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { FORM_PDF_MAX_BYTES, formPdfFilename } from "../../lib/forms/pdf-receipt";
import styles from "./forms.module.css";

export function DownloadFormPdf({ submissionId, automatic = false, signedOriginal = false }: { submissionId: string; automatic?: boolean; signedOriginal?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const attempted = useRef<string | null>(null);
  const download = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try {
      const filename = formPdfFilename(submissionId);
      const response = await fetch(`/api/form-submissions/${submissionId}/pdf`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (response.status === 401) throw new Error("Sign in again to download your saved form.");
      if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/pdf") throw new Error("Your form is saved. The PDF could not be downloaded. Please try again.");
      if (Number(response.headers.get("content-length")) > FORM_PDF_MAX_BYTES) throw new Error("This PDF is too large to download here. Contact the team for a copy.");
      const blob = await response.blob();
      if (!blob.size || blob.size > FORM_PDF_MAX_BYTES) throw new Error("The PDF could not be downloaded. Please try again.");
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The PDF could not be downloaded. Please try again.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      active.current = null;
    }
  }, [submissionId]);
  useEffect(() => {
    let disposed = false;
    // Strict Mode may clean up the first effect before its download starts.
    queueMicrotask(() => {
      if (!disposed && automatic && attempted.current !== submissionId) { attempted.current = submissionId; void download(); }
    });
    return () => { disposed = true; };
  }, [automatic, download, submissionId]);
  useEffect(() => () => { active.current?.abort(); }, []);
  return <div className={styles.pdfDownload}>
    <button type="button" className="button-secondary" disabled={busy} aria-busy={busy || undefined} onClick={() => void download()}><Download aria-hidden="true" />{busy ? "Preparing PDF…" : "Download PDF"}</button>
    {signedOriginal ? <a className="button-secondary" href={`/api/form-submissions/${submissionId}/pdf?original=signed`} download><Download aria-hidden="true" />Download original signed agreement</a> : null}
    {automatic ? <p>Your form is saved. If the download does not start, use Download PDF.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
