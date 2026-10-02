"use client";

import {
  Bold,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  Redo2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useRef, useState, type ClipboardEvent } from "react";
import { useFormStatus } from "react-dom";
import {
  createServiceAction,
  updateServiceAction,
  type CatalogFormState,
} from "../../app/actions/services";
import type { ServiceFolderRow, ServiceRow } from "../../lib/supabase/database-rows";
import type { ServiceAssigneeOption } from "../../repositories/service-repository";

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button className="button-primary" disabled={pending} aria-busy={pending || undefined} type="submit">
      {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
      {mode === "create" ? "Create service" : "Save changes"}
    </button>
  );
}

function EditorButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

export function RichTextDescription({
  initialValue,
  initialHtml,
}: {
  initialValue: string;
  initialHtml: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function syncDescription() {
    const editor = editorRef.current;
    const input = inputRef.current;
    if (editor && input) input.value = editor.innerHTML;
  }

  function runCommand(command: string, value?: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    syncDescription();
  }

  function createLink() {
    const href = window.prompt("Link URL", "https://");
    if (!href) return;

    try {
      const url = new URL(href, window.location.origin);
      if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return;
      runCommand("createLink", href);
    } catch {
      // Ignore invalid URLs and leave the selected text unchanged.
    }
  }

  function pastePlainText(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    syncDescription();
  }

  return (
    <div className="service-rich-field">
      <div className="service-rich-toolbar" aria-label="Description formatting">
        <EditorButton label="Bold" icon={Bold} onClick={() => runCommand("bold")} />
        <EditorButton label="Italic" icon={Italic} onClick={() => runCommand("italic")} />
        <EditorButton label="Heading" icon={Heading2} onClick={() => runCommand("formatBlock", "h2")} />
        <span className="service-rich-toolbar-divider" aria-hidden="true" />
        <EditorButton label="Bulleted list" icon={List} onClick={() => runCommand("insertUnorderedList")} />
        <EditorButton label="Numbered list" icon={ListOrdered} onClick={() => runCommand("insertOrderedList")} />
        <EditorButton label="Link" icon={Link2} onClick={createLink} />
        <span className="service-rich-toolbar-divider" aria-hidden="true" />
        <EditorButton label="Undo" icon={Undo2} onClick={() => runCommand("undo")} />
        <EditorButton label="Redo" icon={Redo2} onClick={() => runCommand("redo")} />
      </div>
      <input ref={inputRef} type="hidden" name="description" defaultValue={initialValue} />
      <div
        ref={editorRef}
        id="service-description"
        className="service-rich-editor"
        role="textbox"
        aria-label="Description"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Add a service description"
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        onInput={syncDescription}
        onBlur={syncDescription}
        onPaste={pastePlainText}
      />
    </div>
  );
}

export function ServiceForm({
  mode,
  service,
  descriptionHtml = "",
  folders,
  assignees,
  preselectedFolderId,
}: {
  mode: "create" | "edit";
  service?: ServiceRow;
  descriptionHtml?: string;
  folders: ServiceFolderRow[];
  assignees: ServiceAssigneeOption[];
  /** Lock the folder when the create flow is entered from inside a folder. */
  preselectedFolderId?: string;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [recurring, setRecurring] = useState(service?.recurring ?? false);
  const initialState: CatalogFormState = { error: null };
  const updateAction = service ? updateServiceAction.bind(null, service.id) : null;
  const [state, action] = useActionState(
    mode === "edit" && updateAction ? updateAction : createServiceAction,
    initialState,
  );

  return (
    <form action={action} className="service-editor-form">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="is_active" value={String(service?.is_active ?? true)} />

      {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}

      <section className="service-form-section" aria-labelledby="service-basic-heading">
        <div className="service-form-section-heading">
          <h2 id="service-basic-heading">Basic</h2>
        </div>
        <div className="service-form-fields">
          <label className="service-field service-field-wide" htmlFor="service-name">
            <span>Service name</span>
            <input id="service-name" name="name" defaultValue={service?.name ?? ""} maxLength={200} required />
          </label>
          <label className="service-field service-field-folder" htmlFor="service-folder">
            <span>Folder</span>
            <select
              id="service-folder"
              name="folder_id"
              defaultValue={preselectedFolderId ?? service?.folder_id ?? ""}
              disabled={preselectedFolderId != null}
            >
              <option value="">Unfiled</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            {preselectedFolderId != null ? (
              <input type="hidden" name="folder_id" value={preselectedFolderId} />
            ) : null}
          </label>
          <div className="service-field service-field-wide">
            <label htmlFor="service-description">Description <small>optional</small></label>
            <RichTextDescription
              initialValue={service?.description ?? ""}
              initialHtml={descriptionHtml}
            />
          </div>
          <div className="service-field service-field-wide">
            <span>Image <small>unavailable</small></span>
            <button className="service-disabled-control" type="button" disabled>Image upload is not configured</button>
            <small className="service-field-help">A media upload domain does not exist yet, so no placeholder asset will be stored.</small>
          </div>
        </div>
      </section>

      <section className="service-form-section" aria-labelledby="service-pricing-heading">
        <div className="service-form-section-heading">
          <h2 id="service-pricing-heading">Pricing</h2>
        </div>
        <div className="service-form-fields">
          <label className="service-field" htmlFor="service-price">
            <span>Price</span>
            <input id="service-price" name="price" type="number" min="0" step="0.01" defaultValue={service?.price ?? 0} required />
          </label>
          <label className="service-field" htmlFor="service-currency">
            <span>Currency</span>
            <select id="service-currency" name="currency" defaultValue={service?.currency ?? "USD"}>
              {['USD', 'PHP', 'EUR', 'GBP', 'CAD', 'AUD'].map((currency) => <option key={currency}>{currency}</option>)}
            </select>
          </label>
          <label className="service-toggle service-field-wide">
            <input
              name="recurring"
              type="checkbox"
              defaultChecked={recurring}
              onChange={(event) => setRecurring(event.currentTarget.checked)}
            />
            <span><strong>Recurring service</strong><small>Repeat on a validated interval.</small></span>
          </label>
          {recurring ? (
            <div className="service-recurring-grid service-field-wide">
              <label className="service-field" htmlFor="service-recurring-price">
                <span>Recurring price</span>
                <input id="service-recurring-price" name="recurring_price" type="number" min="0" step="0.01" defaultValue={service?.recurring_price ?? service?.price ?? ""} required />
              </label>
              <label className="service-field" htmlFor="service-interval-length">
                <span>Every</span>
                <input id="service-interval-length" name="recurring_interval_length" type="number" min="1" step="1" defaultValue={service?.recurring_interval_length ?? 1} required />
              </label>
              <label className="service-field" htmlFor="service-interval-unit">
                <span>Interval unit</span>
                <select id="service-interval-unit" name="recurring_interval_unit" defaultValue={service?.recurring_interval_unit ?? "M"} required>
                  <option value="D">Day</option><option value="W">Week</option><option value="M">Month</option><option value="Y">Year</option>
                </select>
              </label>
              <label className="service-field service-field-wide" htmlFor="service-recurring-action">
                <span>Recurring action</span>
                <select id="service-recurring-action" name="recurring_action" defaultValue={service?.recurring_action ?? "none"} required>
                  <option value="none">Do nothing</option>
                  <option value="reopen_order">Reopen Project</option>
                  <option value="create_order">Create new Project</option>
                  <option value="client_request">Allow client-requested Projects</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </section>

      <section className="service-form-section" aria-labelledby="service-fulfillment-heading">
        <div className="service-form-section-heading">
          <h2 id="service-fulfillment-heading">Fulfillment</h2>
        </div>
        <div className="service-form-fields">
          <label className="service-toggle service-field-wide">
            <input name="group_quantities" type="checkbox" defaultChecked={service?.group_quantities ?? false} />
            <span><strong>Group multiple quantities into one Project</strong><small>Keep one delivery record when quantity is greater than one.</small></span>
          </label>
          <label className="service-field" htmlFor="service-assignee">
            <span>Assigned teammate <small>optional</small></span>
            <select id="service-assignee" name="assigned_to_profile_id" defaultValue={service?.assigned_to_profile_id ?? ""}>
              <option value="">None</option>
              {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.displayName}</option>)}
            </select>
          </label>
          <div className="service-deadline-field">
            <label className="service-field" htmlFor="service-deadline-amount">
              <span>Deadline <small>optional</small></span>
              <input id="service-deadline-amount" name="deadline_amount" type="number" min="1" step="1" defaultValue={service?.deadline_amount ?? ""} />
            </label>
            <label className="service-field" htmlFor="service-deadline-unit">
              <span>Unit</span>
              <select id="service-deadline-unit" name="deadline_unit" defaultValue={service?.deadline_unit ?? "D"}>
                <option value="D">Day(s)</option><option value="H">Hour(s)</option>
              </select>
            </label>
          </div>
          <div className="service-field service-field-wide">
            <span>Intake form <small>unavailable</small></span>
            <select disabled aria-label="Intake form unavailable"><option>Forms domain is not implemented</option></select>
            <small className="service-field-help">This will become selectable after real intake forms exist.</small>
          </div>
          <label className="service-toggle service-field-wide">
            <input name="require_client_profile" type="checkbox" defaultChecked={service?.require_client_profile ?? false} />
            <span><strong>Require client profile</strong><small>Only allow Project creation for clients with a linked profile.</small></span>
          </label>
        </div>
      </section>

      <section className="service-form-section" aria-labelledby="service-subscription-heading">
        <div className="service-form-section-heading">
          <h2 id="service-subscription-heading">Subscription availability</h2>
        </div>
        <div className="service-form-fields">
          <label className="service-toggle service-field-wide">
            <input name="subscription_eligible" type="checkbox" defaultChecked={service?.subscription_eligible ?? false} />
            <span><strong>Available for subscriptions</strong><small>When enabled, this service can be selected when creating or changing a subscription.</small></span>
          </label>
        </div>
      </section>

      <section className="service-form-section" aria-labelledby="service-visibility-heading">
        <div className="service-form-section-heading">
          <h2 id="service-visibility-heading">Visibility</h2>
        </div>
        <div className="service-form-fields">
          <label className="service-toggle service-field-wide">
            <input name="is_public" type="checkbox" defaultChecked={service?.is_public ?? true} />
            <span><strong>Show in services page</strong><small>Visible to authenticated directory viewers while active.</small></span>
          </label>
          <label className="service-field" htmlFor="service-sort-order">
            <span>Sort order</span>
            <input id="service-sort-order" name="sort_order" type="number" min="0" step="1" defaultValue={service?.sort_order ?? 0} required />
          </label>
        </div>
      </section>

      <div className="service-form-actions">
        <Link className="button-secondary" href={service ? `/services?folder=${service.folder_id ?? "unfiled"}` : "/services"}>Cancel</Link>
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}
