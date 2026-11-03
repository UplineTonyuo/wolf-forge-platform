"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { manageProjectTaskAction, type ProjectTaskCommand } from "../../app/actions/project-tasks";
import type { ProjectCapabilities, ProjectTaskView } from "../../domain/orders/projections";
import { taskStatuses } from "../../domain/tasks/schema";
import { randomUuid } from "../../lib/random-uuid";
import { AnimatedSelect } from "../ui/animated-select";
import styles from "./project-tasks.module.css";

const statusLabels = { todo: "To do", in_progress: "In progress", blocked: "Blocked", complete: "Complete", canceled: "Canceled" };
export function ProjectTasks({ orderId, tasks, people, capabilities }: {
  orderId: string;
  tasks: (ProjectTaskView & { dueLabel: string | null })[];
  people: { id: string; name: string }[];
  capabilities: ProjectCapabilities;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [requestId, setRequestId] = useState(randomUuid);
  const inFlight = useRef(false);
  function run(command: ProjectTaskCommand) {
    if (inFlight.current) return;
    if (command.kind === "create" || command.kind === "rename") {
      command = { ...command, title: command.title.trim() };
      if (!command.title) { setError("Enter a task title."); return; }
    }
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await manageProjectTaskAction(orderId, command);
        if (!result.ok) { setError(result.error); return; }
        if (command.kind === "create") { setTitle(""); setRequestId(randomUuid()); }
        setEditing(null);
        router.refresh();
      } catch { setError("Task save could not be confirmed. Retry to check the same request safely."); }
      finally { inFlight.current = false; }
    });
  }
  return <div className={styles.tasks}>
    {error ? <p role="alert">{error}</p> : null}
    {tasks.length ? tasks.map((task) => <div className={styles.row} key={task.id}>
      {editing === task.id ? <form className={styles.rename} onSubmit={(event) => { event.preventDefault(); run({ kind: "rename", taskId: task.id, title: String(new FormData(event.currentTarget).get("title") ?? "") }); }}>
        <input name="title" aria-label={`Task title for ${task.title}`} defaultValue={task.title} required maxLength={500} disabled={pending} />
        <button type="submit" disabled={pending}>Save</button><button type="button" onClick={() => setEditing(null)} disabled={pending}>Cancel</button>
      </form> : <div className={styles.identity}><strong>{task.title}</strong>{task.dueLabel ? <small>Due {task.dueLabel}{task.overdue ? " · Overdue" : ""}</small> : null}</div>}
      <div className={styles.controls}>
        {capabilities.edit ? <AnimatedSelect name={`status-${task.id}`} label={`Status for ${task.title}`} menuLabel="Task status" compact options={taskStatuses.map((value) => ({ value, label: statusLabels[value] }))} value={task.status} disabled={pending} onChange={(status) => run({ kind: "status", taskId: task.id, status: status as typeof taskStatuses[number] })} /> : <span>{task.statusLabel}</span>}
        {capabilities.edit && capabilities.assign ? <AnimatedSelect name={`assignee-${task.id}`} label={`Assignee for ${task.title}`} menuLabel="Assign task" compact options={[{ value: "none", label: "Unassigned" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} value={task.assigneeId ?? "none"} disabled={pending} onChange={(profileId) => run({ kind: "assign", taskId: task.id, profileId: profileId === "none" ? null : profileId })} /> : <span>{people.find((person) => person.id === task.assigneeId)?.name ?? "Unassigned"}</span>}
        {capabilities.edit ? <div className={styles.buttons}>
          <button type="button" aria-label={`Rename ${task.title}`} onClick={() => setEditing(task.id)} disabled={pending}><Pencil aria-hidden="true" /></button>
        </div> : null}
      </div>
    </div>) : <p className={styles.empty}>No tasks yet. Add the first delivery step below. Clients see progress counts only.</p>}
    {capabilities.edit ? <form className={styles.create} onSubmit={(event) => { event.preventDefault(); run({ kind: "create", title, requestId }); }}>
      <label className={styles.titleField}>Task title<input aria-label="New task title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="e.g. Review delivery" required maxLength={500} disabled={pending} /></label>
      <button type="submit" disabled={pending || !title.trim()}><Plus aria-hidden="true" />Add task</button>
    </form> : null}
    {pending ? <p role="status">Saving task…</p> : null}
  </div>;
}
