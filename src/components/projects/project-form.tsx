"use client";

import { Hash, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createProjectAction,
  updateProjectAction,
  type ProjectFormState,
} from "../../app/actions/orders";
import { orderPriorities } from "../../domain/orders/schema";
import { projectPriorityLabels } from "../../domain/orders/projections";
import type { CompanyRow, OrderRow, ServiceFolderRow, ServiceRow } from "../../lib/supabase/database-rows";
import type { ServiceAssigneeOption } from "../../repositories/service-repository";
import { AnimatedSelect } from "../ui/animated-select";
import { DatePicker } from "../ui/date-picker";
import { SearchableSelect } from "../ui/searchable-select";
import { ProjectClientPicker, ProjectServicePicker } from "./project-pickers";
import styles from "./project-form.module.css";

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();

  return (
    <button className="button-primary" disabled={pending} aria-busy={pending || undefined} type="submit">
      <LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />
      {mode === "create" ? "Create project" : "Save changes"}
    </button>
  );
}

/** `YYYY-MM-DD` value for a date input, or "" when the timestamp is absent. */
function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

const initialProjectFormState: ProjectFormState = {
  error: null,
  fieldErrors: {},
};

export function ProjectForm({
  mode,
  project,
  initialServiceId,
  clients,
  services,
  folders,
  assignees,
  canAssign,
}: {
  mode: "create" | "edit";
  project?: OrderRow;
  initialServiceId?: string | null;
  clients: CompanyRow[];
  services: ServiceRow[];
  folders: ServiceFolderRow[];
  assignees: ServiceAssigneeOption[];
  canAssign: boolean;
}) {
  const [requestId] = useState(() => crypto.randomUUID());

  const [state, action] = useActionState<ProjectFormState, FormData>(
    mode === "edit" && project ? updateProjectAction.bind(null, project.id) : createProjectAction,
    initialProjectFormState,
  );

  /*
   * The custom controls carry the same hidden-input names as the native
   * controls they replace (`priority`, `assigned_to_profile_id`, `due_at`,
   * `started_at`), so the server action contract is unchanged: due/start
   * still submit `YYYY-MM-DD`, an empty teammate value still means
   * "Unassigned", and the database keeps generating the project number.
   */
  const [priority, setPriority] = useState<string>(project?.priority ?? "normal");
  const [assigneeId, setAssigneeId] = useState(project?.assigned_to_profile_id ?? "");
  const [dueDate, setDueDate] = useState(() => dateInputValue(project?.due_at));
  const [startedDate, setStartedDate] = useState(() => dateInputValue(project?.started_at));

  const fieldError = (key: string) => state?.fieldErrors?.[key];

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="request_id" value={requestId} />

      {state?.error ? (
        <div className="form-banner" role="alert">
          {state?.error}
        </div>
      ) : null}

      <div className={styles.fields}>
        <div className={styles.field}>
          <span>Client</span>

          <ProjectClientPicker
            clients={clients}
            initialClientId={project?.company_id ?? null}
            locked={mode === "edit"}
            error={fieldError("company_id")}
          />

          {mode === "edit" ? (
            <small className={styles.help}>
              A project cannot be moved to a different client.
            </small>
          ) : null}
        </div>
        <div className={styles.field}>
          <span>Service</span>

          <ProjectServicePicker
            folders={folders}
            services={services}
            initialServiceId={project?.service_id ?? initialServiceId ?? null}
            error={fieldError("service_id")}
          />
        </div>
<label className={`${styles.field} ${styles.wide}`} htmlFor="project-title">
          <span>Project title</span>
          <input
            id="project-title"
            name="title"
            defaultValue={project?.title ?? ""}
            maxLength={200}
            required
            className={fieldError("title") ? styles.invalid : undefined}
          />
          {fieldError("title") ? <p className="field-error">{fieldError("title")}</p> : null}
        </label>

        <div className={styles.field}>
          <span>Priority</span>
          <AnimatedSelect
            name="priority"
            label="Priority"
            menuLabel="Project priority"
            value={priority}
            onChange={setPriority}
            options={orderPriorities.map((value) => ({
              value,
              label: projectPriorityLabels[value],
            }))}
          />
        </div>

        <div className={styles.field}>
          <span>
            Assigned teammate <small>optional</small>
          </span>
          <SearchableSelect
            name="assigned_to_profile_id"
            label="Assigned teammate"
            menuLabel="Assignees"
            value={assigneeId}
            onChange={setAssigneeId}
            placeholder="Search teammates"
            disabled={!canAssign || mode === "edit"}
            options={[
              { id: "", label: "Unassigned" },
              ...assignees.map((assignee) => ({
                id: assignee.id,
                label: assignee.displayName,
              })),
            ]}
          />
          {mode === "edit" ? (
            <small className={styles.help}>
              Change the assignee from the project actions menu.
            </small>
          ) : null}
          {!canAssign && mode === "create" ? (
            <small className={styles.help}>
              You do not have permission to assign projects, so this project starts unassigned.
            </small>
          ) : null}
        </div>

        <div className={styles.field}>
          <span>
            Due date <small>optional</small>
          </span>
          <DatePicker
            name="due_at"
            label="Due date"
            menuLabel="Project due date"
            value={dueDate}
            onChange={setDueDate}
            clearable
          />
        </div>

        <div className={styles.field}>
          <span>
            Start date <small>optional</small>
          </span>
          <DatePicker
            name="started_at"
            label="Start date"
            menuLabel="Project start date"
            value={startedDate}
            onChange={setStartedDate}
            clearable
          />
        </div>

        <label className={`${styles.field} ${styles.wide}`} htmlFor="project-notes">
          <span>
            Internal notes <small>staff only</small>
          </span>
          <textarea id="project-notes" name="notes" defaultValue={project?.notes ?? ""} rows={5} />
        </label>

        {mode === "create" ? (
          <p className={`${styles.generated} ${styles.wide}`}>
            <Hash size={14} aria-hidden="true" />
            The project number is generated by the database when the project is created.
          </p>
        ) : null}
      </div>

      <div className="form-actions">
        <Link className="button-secondary" href={project ? `/orders/${project.id}` : "/orders"}>
          Cancel
        </Link>
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}
