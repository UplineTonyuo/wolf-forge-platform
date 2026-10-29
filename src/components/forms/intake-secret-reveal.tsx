"use client";

import { Copy, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { listIntakeSecretReferences, revealIntakeSecret } from "../../app/actions/intake-secrets";
import styles from "./intake-secret-reveal.module.css";

function SecretControl({ credentialId, label }: { credentialId: string; label: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const loading = useRef(false);
  const valueId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function hide() {
    generation.current++;
    loading.current = false;
    setSecret(null);
    setPending(false);
    setMessage(null);
    setError(null);
  }

  async function reveal() {
    if (loading.current) return;
    loading.current = true;
    const request = ++generation.current;
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await revealIntakeSecret(credentialId);
      if (!mounted.current || generation.current !== request) return;
      if (!result.ok || typeof result.secret !== "string" || !result.secret.length) {
        setError("The password could not be revealed. Check your access and try again.");
      } else setSecret(result.secret);
    } catch {
      if (mounted.current && generation.current === request) setError("The password could not be revealed. Check your access and try again.");
    } finally {
      if (mounted.current && generation.current === request) { loading.current = false; setPending(false); }
    }
  }

  async function copy() {
    if (secret === null) return;
    const request = generation.current;
    setMessage(null);
    setError(null);
    try {
      await navigator.clipboard.writeText(secret);
      if (mounted.current && generation.current === request) setMessage("Password copied.");
    } catch {
      if (mounted.current && generation.current === request) setError("The password could not be copied. Select it and copy it manually.");
    }
  }

  return <div className={styles.control}>
    {secret !== null ? <input id={valueId} aria-label={`${label} value`} type="text" value={secret} readOnly autoComplete="off" spellCheck={false} />
      : <span id={valueId} className={styles.masked}>{pending ? "Revealing password…" : "Password saved securely"}</span>}
    <div className={styles.actions}>
      <button type="button" className="button-secondary" aria-controls={valueId} aria-expanded={secret !== null} aria-busy={pending || undefined}
        aria-label={pending ? `Cancel revealing ${label}` : secret !== null ? `Hide ${label}` : `Reveal ${label}`}
        onClick={() => { if (pending || secret !== null) hide(); else void reveal(); }}>
        {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : secret !== null ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        {pending ? "Cancel reveal" : secret !== null ? "Hide password" : "Reveal password"}
      </button>
      {secret !== null ? <button type="button" className="button-secondary" aria-label={`Copy ${label}`} onClick={() => void copy()}><Copy aria-hidden="true" />Copy password</button> : null}
    </div>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

export function IntakeSecretReveal({ credentialId, label }: { credentialId: string; label: string }) {
  return <SecretControl key={credentialId} credentialId={credentialId} label={label} />;
}

function ReferenceList({ submissionId }: { submissionId: string }) {
  const [references, setReferences] = useState<Array<{ credential_id: string; field_key: string; label: string }> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const loading = useRef(false);
  const contentId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function hide() {
    generation.current++;
    loading.current = false;
    setReferences(null);
    setPending(false);
    setError(null);
  }

  async function load() {
    if (loading.current) return;
    loading.current = true;
    const request = ++generation.current;
    setPending(true);
    setError(null);
    try {
      const result = await listIntakeSecretReferences(submissionId);
      if (!mounted.current || generation.current !== request) return;
      if (!result.ok) setError("Saved passwords are unavailable under your current access.");
      else setReferences(result.references);
    } catch {
      if (mounted.current && generation.current === request) setError("Saved passwords are unavailable under your current access.");
    } finally {
      if (mounted.current && generation.current === request) { loading.current = false; setPending(false); }
    }
  }

  return <section className={styles.references} aria-label="Saved passwords">
    <button type="button" className="button-secondary" aria-expanded={references !== null} aria-controls={contentId} aria-busy={pending || undefined}
      onClick={() => { if (pending || references !== null) hide(); else void load(); }}>
      {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : references !== null ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      {pending ? "Cancel password list" : references !== null ? "Hide saved passwords" : "Show saved passwords"}
    </button>
    <div id={contentId}>
      {references?.map((reference) => <div className={styles.reference} key={`${reference.field_key}:${reference.credential_id}`} role="group" aria-label={reference.label}>
        <strong>{reference.label}</strong><IntakeSecretReveal credentialId={reference.credential_id} label={reference.label} />
      </div>)}
      {references?.length === 0 ? <p>No saved passwords in this response.</p> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

export function IntakeSecretReferences({ submissionId }: { submissionId: string }) {
  return <ReferenceList key={submissionId} submissionId={submissionId} />;
}
