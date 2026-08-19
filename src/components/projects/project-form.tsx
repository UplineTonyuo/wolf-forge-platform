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
import { ProjectClientPicker, ProjectServicePicker } from "./project-pickers";
import styles from "./project-form.module.css";

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();

  return (
    <button className="button-primary" disabled={pending} type="submit">
      {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
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

        <label className={styles.field} htmlFor="project-priority">
          <span>Priority</span>
          <select id="project-priority" name="priority" defaultValue={project?.priority ?? "normal"}>
            {orderPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {projectPriorityLabels[priority]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field} htmlFor="project-assignee">
          <span>
            Assigned teammate <small>optional</small>
          </span>
          <select
            id="project-assignee"
            name="assigned_to_profile_id"
            defaultValue={project?.assigned_to_profile_id ?? ""}
            disabled={!canAssign || mode === "edit"}
            aria-describedby={mode === "edit" ? "project-assignee-help" : undefined}
          >
            <option value="">Unassigned</option>
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.displayName}
              </option>
            ))}
          </select>
          {mode === "edit" ? (
            <small className={styles.help} id="project-assignee-help">
              Change the assignee from the project actions menu.
            </small>
          ) : null}
          {!canAssign && mode === "create" ? (
            <small className={styles.help}>
              You do not have permission to assign projects, so this project starts unassigned.
            </small>
          ) : null}
        </label>

        <label className={styles.field} htmlFor="project-due">
          <span>
            Due date <small>optional</small>
          </span>
          <input id="project-due" name="due_at" type="date" defaultValue={dateInputValue(project?.due_at)} />
        </label>

        <label className={styles.field} htmlFor="project-started">
          <span>
            Start date <small>optional</small>
          </span>
          <input
            id="project-started"
            name="started_at"
            type="date"
            defaultValue={dateInputValue(project?.started_at)}
          />
        </label>

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
