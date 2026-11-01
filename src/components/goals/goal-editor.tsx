"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2, Upload, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { saveGoalAction } from "../../app/actions/goals";
import { GOAL_PHOTO_MAX_BYTES, goalInputSchema, type Goal, type GoalMember } from "../../domain/goals/schema";
import { AnimatedSelect } from "../ui/animated-select";
import { DatePicker } from "../ui/date-picker";
import { SheetFrame } from "../ui/mobile-filter-sheet";
import { useExitTransition } from "../team/use-exit-transition";
import styles from "./goals.module.css";

export async function uploadGoalPhoto(id: string, file: File): Promise<void> {
  if (file.size > GOAL_PHOTO_MAX_BYTES || file.size === 0) throw new Error("Choose a photo, 2 MB or smaller.");
  const response = await fetch("/api/team-goals/" + id + "/photo", {
    method: "POST", body: file, credentials: "same-origin",
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(typeof result.error === "string" ? result.error : "Photo upload failed. Try again.");
}

export function GoalEditor({ goal, members, actorId, onClose }: {
  goal?: Goal; members: GoalMember[]; actorId: string; onClose: () => void;
}) {
  const router = useRouter(), formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [owner, setOwner] = useState(goal?.owner_profile_id ?? actorId);
  const [due, setDue] = useState(goal?.due_date ?? "");
  const [visibility, setVisibility] = useState<"shared" | "leadership">(goal?.visibility ?? "shared");
  const [milestones, setMilestones] = useState((goal?.milestones ?? []).map(item => ({ id: item.id, title: item.title, key: item.id })));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [discardPrompt, setDiscardPrompt] = useState(false), [open, setOpen] = useState(true);
  const { render: mounted } = useExitTransition(open, 150);
  const formRef = useRef<HTMLFormElement>(null), titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null), keepRef = useRef<HTMLButtonElement>(null);
  const wasPrompt = useRef(false);
  const [baseline] = useState(() => JSON.stringify({
    title: goal?.title ?? "", description: goal?.description ?? "", owner: goal?.owner_profile_id ?? actorId,
    due: goal?.due_date ?? "", visibility: goal?.visibility ?? "shared",
    milestones: (goal?.milestones ?? []).map(item => ({ id: item.id, title: item.title })),
  }));
  const dirty = file !== null || baseline !== JSON.stringify({
    title, description, owner, due, visibility, milestones: milestones.map(({ id, title }) => ({ id, title })),
  });
  const eligible = members.filter(member => visibility === "shared" || ["owner", "admin"].includes(member.role));
  const eligibleOwner = eligible.some(member => member.id === owner);
  const errorId = (key: string) => formId + "-error-" + key.replaceAll(".", "-");
  const fieldError = (key: string) => fields[key] ? <p className={styles.fieldError} id={errorId(key)} role="alert">{fields[key]}</p> : null;
  function clearField(key: string) {
    setFields(current => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; });
  }

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (!mounted) onClose(); }, [mounted, onClose]);
  useEffect(() => {
    if (discardPrompt) keepRef.current?.focus({ preventScroll: true });
    else if (wasPrompt.current) titleRef.current?.focus({ preventScroll: true });
    wasPrompt.current = discardPrompt;
  }, [discardPrompt]);
  useEffect(() => {
    if (validationAttempt) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus();
  }, [validationAttempt]);

  function requestClose() {
    if (pending) return;
    if (discardPrompt) { setDiscardPrompt(false); return; }
    if (dirty) setDiscardPrompt(true); else setOpen(false);
  }
  function choosePhoto(next: File | null) {
    if (!next) return;
    if (!next.size || next.size > GOAL_PHOTO_MAX_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(next.type)) {
      setFields(current => ({ ...current, photo: "Choose a JPEG, PNG or WebP photo, 2 MB or smaller." }));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(next); setPreview(URL.createObjectURL(next)); clearField("photo");
  }
  function removePhoto() {
    setFile(null); setPreview(null); clearField("photo");
    if (fileRef.current) fileRef.current.value = "";
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return; setError("");
    const parsed = goalInputSchema.safeParse({
      title, description, owner_profile_id: owner, due_date: due || null, visibility,
      milestones: milestones.map(item => ({ ...(item.id ? { id: item.id } : {}), title: item.title })), request_id: requestId,
    });
    const invalid: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      invalid[key] = key === "title" ? (title.trim() ? "Use 160 characters or fewer." : "Enter a goal title.")
        : key === "owner_profile_id" ? "Choose the person responsible for this goal."
        : key === "due_date" ? "Choose a valid date."
        : key.startsWith("milestones.") ? "Enter a milestone name, up to 200 characters."
        : key === "description" ? "Use 4,000 characters or fewer." : "Use at most 50 milestones.";
    }
    if (!eligibleOwner) invalid.owner_profile_id = visibility === "leadership"
      ? "Choose an Owner or Admin for a leadership goal." : "Choose an active team member.";
    if (fields.photo) invalid.photo = fields.photo;
    if (Object.keys(invalid).length || !parsed.success) {
      setFields(invalid); setValidationAttempt(value => value + 1); return;
    }
    setFields({}); setPending(true);
    try {
      const result = await saveGoalAction(goal?.id ?? null, parsed.data, goal?.updated_at ?? null);
      if (!result.ok) { setError(result.error); return; }
      let photoFailed = false;
      if (file) { try { await uploadGoalPhoto(result.goal.id, file); } catch { photoFailed = true; } }
      setOpen(false);
      router.push("/team/goals/" + result.goal.id + (photoFailed ? "?photo=retry" : "")); router.refresh();
    } catch { setError("Unable to confirm this save. Retry the same goal or reload before making changes."); }
    finally { setPending(false); }
  }

  return <SheetFrame open={open} onClose={requestClose}
    label={discardPrompt ? "Discard unsaved changes?" : goal ? "Edit goal" : "New goal"}
    eyebrow="TEAM GOALS" closeLabel={discardPrompt ? "Close confirmation" : "Close goal editor"}
    footer={<div className={styles.actions}>{discardPrompt ? <>
      <button ref={keepRef} className="button-primary" type="button" onClick={() => setDiscardPrompt(false)}>Keep editing</button>
      <button className="button-secondary" type="button" onClick={() => setOpen(false)}>Discard changes</button>
    </> : <>
      <button className="button-secondary" type="button" onClick={requestClose} disabled={pending}>Cancel</button>
      <button className="button-primary" form={formId} type="submit" disabled={pending}>
        {pending ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}{pending ? "Saving…" : "Save goal"}
      </button>
    </>}</div>}>
    {discardPrompt ? <p>Your goal has unsaved changes. Keep editing to preserve them, or discard this draft.</p> : null}
    <form ref={formRef} id={formId} noValidate hidden={discardPrompt} onSubmit={submit} className={styles.editor} aria-busy={pending}>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.field}>
        <label htmlFor={formId + "-title"}>Goal title</label>
        <input ref={titleRef} id={formId + "-title"} autoComplete="off" value={title} maxLength={160} required disabled={pending}
          aria-invalid={Boolean(fields.title) || undefined} aria-describedby={fields.title ? errorId("title") : undefined}
          onChange={event => { setTitle(event.target.value); clearField("title"); }} />{fieldError("title")}
      </div>
      <div className={styles.field}>
        <label htmlFor={formId + "-description"}>Description</label>
        <textarea id={formId + "-description"} value={description} maxLength={4000} rows={3} disabled={pending}
          aria-invalid={Boolean(fields.description) || undefined} aria-describedby={fields.description ? errorId("description") : undefined}
          onChange={event => { setDescription(event.target.value); clearField("description"); }} />{fieldError("description")}
      </div>
      <div className={styles.formGrid}>
        <div className={styles.field}><span>Visibility</span>
          <AnimatedSelect name="visibility" label="Goal visibility" menuLabel="Goal visibility" value={visibility} disabled={pending}
            options={[{ value: "shared", label: "Shared with team" }, { value: "leadership", label: "Owner/Admin only" }]}
            onChange={value => {
              const next = value as "shared" | "leadership"; setVisibility(next);
              if (next === "leadership" && !members.some(member => member.id === owner && ["owner", "admin"].includes(member.role)))
                setFields(current => ({ ...current, owner_profile_id: "Choose an Owner or Admin for a leadership goal." }));
              else clearField("owner_profile_id");
            }} />
        </div>
        <div className={styles.field}><span>Responsible person</span>
          <AnimatedSelect name="owner" label="Goal owner" menuLabel="Goal owner" value={eligibleOwner ? owner : ""} disabled={pending}
            invalid={Boolean(fields.owner_profile_id)} describedBy={fields.owner_profile_id ? errorId("owner_profile_id") : undefined}
            options={[{ value: "", label: "Choose a person", disabled: true }, ...eligible.map(member => ({ value: member.id, label: member.display_name }))]}
            onChange={value => { setOwner(value); clearField("owner_profile_id"); }} required />{fieldError("owner_profile_id")}
        </div>
        <div className={styles.field}><span>Due date</span>
          <DatePicker name="due" label="Goal due date" menuLabel="Choose goal due date" value={due} disabled={pending}
            invalid={Boolean(fields.due_date)} describedBy={fields.due_date ? errorId("due_date") : undefined}
            onChange={value => { setDue(value); clearField("due_date"); }} clearable />{fieldError("due_date")}
        </div>
      </div>
      <div>
        <label className={styles.upload}><Upload aria-hidden="true" />
          <span>{file ? "Choose another photo" : goal?.photo_path ? "Replace goal photo" : "Upload goal photo"}<small>Optional · JPEG, PNG or WebP · up to 2 MB</small></span>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={pending}
            aria-label="Goal photo" aria-invalid={Boolean(fields.photo) || undefined} aria-describedby={fields.photo ? errorId("photo") : undefined}
            onChange={event => choosePhoto(event.target.files?.[0] ?? null)} />
        </label>{fieldError("photo")}
        {fields.photo && !file ? <button type="button" className="button-secondary" onClick={removePhoto}>Continue without a photo</button> : null}
        {preview && file ? <div className={styles.photoPreview}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Local, short-lived selected-file preview. */}
          <img src={preview} alt="Selected goal photo" />
          <div><span>{file.name}</span><button type="button" className="button-secondary" disabled={pending} onClick={removePhoto} aria-label="Remove selected photo">Remove photo</button></div>
        </div> : null}
      </div>
      <div><h3 className={styles.sectionTitle}>Milestones</h3><p className={styles.muted}>Milestones are assigned to the responsible person.</p>{fieldError("milestones")}</div>
      {milestones.map((item, index) => {
        const key = "milestones." + index + ".title", id = formId + "-milestone-" + index;
        return <div className={styles.milestoneEditor} key={item.key}>
          <div className={styles.field}><label htmlFor={id} className="sr-only">Milestone {index + 1}</label>
            <input id={id} value={item.title} placeholder="Milestone name" maxLength={200} required disabled={pending}
              aria-invalid={Boolean(fields[key]) || undefined} aria-describedby={fields[key] ? errorId(key) : undefined}
              onChange={event => { setMilestones(values => values.map((value, i) => i === index ? { ...value, title: event.target.value } : value)); clearField(key); }} />{fieldError(key)}
          </div>
          <button type="button" className={styles.iconButton} disabled={pending} aria-label={"Remove milestone " + (index + 1)}
            onClick={() => { setMilestones(values => values.filter((_, i) => i !== index)); setFields(values => Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith("milestones")))); }}><Trash2 aria-hidden="true" /></button>
        </div>;
      })}
      <button type="button" className="button-secondary" disabled={pending || milestones.length >= 50}
        onClick={() => setMilestones(values => [...values, { id: "", title: "", key: crypto.randomUUID() }])}><Plus aria-hidden="true" />Add milestone</button>
    </form>
  </SheetFrame>;
}
