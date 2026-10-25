"use client";

import type { FormDefinition } from "../../domain/forms/schema";
import type { ServiceRow } from "../../lib/supabase/database-rows";
import { AnimatedSelect } from "../ui/animated-select";
import { ServicePicker, type PickerFolder } from "../services/service-picker";
import styles from "./forms.module.css";

export function FormRequestOptions({ config, services, folders, onChange }: {
  config: FormDefinition["type_config"]; services: ServiceRow[]; folders: PickerFolder[];
  onChange: (config: FormDefinition["type_config"]) => void;
}) {
  const actions = config.automation && typeof config.automation === "object" && !Array.isArray(config.automation) ? config.automation : {};
  const steps = Array.isArray(actions.workflow_steps) ? actions.workflow_steps.filter((step): step is string => typeof step === "string") : [];
  function update(patch: typeof actions) { onChange({ ...config, automation: { ...actions, ...patch } }); }
  return <section className={styles.requestOptions} aria-labelledby="request-options-title">
    <header><span>REQUEST FORMS</span><h2 id="request-options-title">After submission</h2><p>Choose what this form does after a client submits it. Changes take effect when you publish.</p></header>
    <label className={styles.toggle}><input type="checkbox" checked={actions.create_project === true} onChange={(event) => update({ create_project: event.target.checked, project_title: typeof actions.project_title === "string" ? actions.project_title : "New client request" })} />Create a project</label>
    {actions.create_project === true ? <div className={styles.requestOptionsGrid}>
      <ServicePicker label="Project Service" folders={folders} services={services} value={typeof actions.service_id === "string" ? actions.service_id : ""} onChange={(service_id) => update({ service_id })} />
      <label>Project title<input value={typeof actions.project_title === "string" ? actions.project_title : ""} maxLength={200} onChange={(event) => update({ project_title: event.target.value })} /></label>
    </div> : null}
    <label className={styles.toggle}><input type="checkbox" checked={typeof actions.task_title === "string"} onChange={(event) => update({ task_title: event.target.checked ? "Review submitted request" : null })} />Create a task</label>
    {typeof actions.task_title === "string" ? <label>Task title<input value={actions.task_title} maxLength={200} onChange={(event) => update({ task_title: event.target.value })} /></label> : null}
    <p>Tasks are added to the new project, or to the project this intake form was assigned to.</p>
    <AnimatedSelect name="submission-crm-status" label="Update CRM status" menuLabel="CRM status after submission"
      value={typeof actions.crm_status === "string" ? actions.crm_status : ""} onChange={(value) => update({ crm_status: value || null })}
      options={[{ value: "", label: "Keep current status" }, { value: "contact", label: "Contact" }, { value: "lead", label: "Lead" }, { value: "client", label: "Client" }, { value: "client_team", label: "Client Team" }]} />
    <label>Start a workflow<textarea rows={4} value={steps.join("\n")} placeholder="One project task per line" onChange={(event) => update({ workflow_steps: event.target.value.split("\n") })} />
      <small>Optional checklist, up to 20 tasks. Each line becomes a task in the project after submission.</small></label>
    <AnimatedSelect name="incomplete-form-reminders" label="Incomplete-form reminders" menuLabel="Reminder interval"
      value={String(typeof config.reminder_days === "number" ? config.reminder_days : 0)} onChange={(value) => onChange({ ...config, reminder_days: Number(value) })}
      options={[{ value: "0", label: "Off" }, { value: "1", label: "Every day" }, { value: "3", label: "Every 3 days" }, { value: "7", label: "Every week" }, { value: "14", label: "Every 2 weeks" }, { value: "30", label: "Every 30 days" }]} />
    <p>Up to three reminders appear in the client’s workspace and on devices with push enabled. Scheduled processing must be configured for this environment.</p>
  </section>;
}
