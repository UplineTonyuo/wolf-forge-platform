import type {
  AssignFormInput,
  AssignedFormDetail,
  CorrectFormSubmissionInput,
  CreateFormInput,
  FormAssignmentSummary,
  FormDefinition,
  FormDetail,
  FormPublishedSchema,
  FormSubmissionDetail,
  FormSubmissionSummary,
  SubmitFormInput,
  UpdateFormDraftInput,
} from "../domain/forms/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { Database, Json } from "../lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FormAssignmentRow,
  FormFieldOptionRow,
  FormRow,
  FormRuleRow,
  FormServiceLinkRow,
  FormSubmissionRow,
  FormVersionFieldRow,
  FormVersionRow,
} from "../lib/supabase/database-rows";
import { unwrapOne } from "../lib/supabase/repository-helpers";

const asJson = (value: unknown) => value as Json;
const asObject = (value: Json | null): FormDefinition["type_config"] =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as unknown as FormDefinition["type_config"]
    : {};

export class FormRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async list(): Promise<FormRow[]> {
    const result = await this.client
      .from("forms")
      .select()
      .is("archived_at", null)
      .order("updated_at", { ascending: false });
    if (result.error) throw mapDatabaseError(result.error, "Forms");
    return (result.data ?? []) as FormRow[];
  }

  async getById(id: string): Promise<FormDetail> {
    const form = unwrapOne(
      await this.client.from("forms").select().eq("id", id).single(),
      "Form",
    ) as FormRow;
    const [versionsResult, draftDefinition] = await Promise.all([
      this.client.from("form_versions").select().eq("form_id", id).order("version_number"),
      this.getVersionDefinition(id, form.current_draft_version_id ?? ""),
    ]);
    if (versionsResult.error) throw mapDatabaseError(versionsResult.error, "Form versions");
    return {
      form,
      versions: (versionsResult.data ?? []) as FormVersionRow[],
      draftDefinition,
    };
  }

  async getVersionDefinition(formId: string, versionId: string): Promise<FormDefinition> {
    const version = unwrapOne(
      await this.client.from("form_versions").select().eq("id", versionId).eq("form_id", formId).single(),
      "Form version",
    ) as FormVersionRow;
    const form = unwrapOne(
      await this.client.from("forms").select("name").eq("id", formId).single(),
      "Form",
    ) as Pick<FormRow, "name">;
    const [fieldsResult, rulesResult, linksResult] = await Promise.all([
      this.client.from("form_version_fields").select().eq("form_version_id", versionId).order("sort_order"),
      this.client.from("form_rules").select().eq("form_version_id", versionId).order("sort_order"),
      this.client.from("form_service_links").select().eq("form_version_id", versionId).order("sort_order"),
    ]);
    if (fieldsResult.error) throw mapDatabaseError(fieldsResult.error, "Form fields");
    if (rulesResult.error) throw mapDatabaseError(rulesResult.error, "Form rules");
    if (linksResult.error) throw mapDatabaseError(linksResult.error, "Form Service links");
    const fields = (fieldsResult.data ?? []) as FormVersionFieldRow[];
    const fieldIds = fields.map((field) => field.id);
    const optionsResult = fieldIds.length
      ? await this.client.from("form_field_options").select().in("form_version_field_id", fieldIds).order("sort_order")
      : { data: [], error: null };
    if (optionsResult.error) throw mapDatabaseError(optionsResult.error, "Form field options");
    const options = (optionsResult.data ?? []) as FormFieldOptionRow[];
    const links = (linksResult.data ?? []) as FormServiceLinkRow[];
    return {
      name: form.name,
      title: version.title,
      information_html: version.information_html,
      visibility: version.visibility,
      type_config: asObject(version.type_config),
      fields: fields.map((field) => ({
        stable_field_key: field.stable_field_key,
        sort_order: field.sort_order,
        field_type: field.field_type,
        label: field.label,
        internal_label: field.internal_label,
        placeholder: field.placeholder,
        help_html: field.help_html,
        default_value: field.default_value as FormDefinition["fields"][number]["default_value"],
        required: field.required,
        settings: asObject(field.settings),
        options: options.filter((option) => option.form_version_field_id === field.id).map((option) => ({
          stable_option_key: option.stable_option_key,
          option_value: option.option_value,
          label: option.label,
          sort_order: option.sort_order,
          metadata: asObject(option.metadata),
        })),
        service_links: links.filter((link) => link.form_version_field_id === field.id).map((link) => ({
          service_id: link.service_id,
          role: link.role,
          sort_order: link.sort_order,
          configuration: asObject(link.configuration),
        })),
      })),
      rules: ((rulesResult.data ?? []) as FormRuleRow[]).map((rule) => ({
        rule_key: rule.rule_key,
        sort_order: rule.sort_order,
        conditions: rule.conditions as FormDefinition["rules"][number]["conditions"],
        action: rule.action,
        target_field_keys: rule.target_field_keys as string[],
      })),
      service_links: links.filter((link) => link.form_version_field_id == null).map((link) => ({
        service_id: link.service_id,
        role: link.role,
        sort_order: link.sort_order,
        configuration: asObject(link.configuration),
      })),
    };
  }

  async getVersionSchema(formId: string, versionId: string): Promise<FormPublishedSchema> {
    const form = unwrapOne(
      await this.client.from("forms").select().eq("id", formId).single(),
      "Form",
    ) as FormRow;
    const version = unwrapOne(
      await this.client.from("form_versions").select().eq("id", versionId).eq("form_id", formId).single(),
      "Form version",
    ) as FormVersionRow;
    const [fieldsResult, rulesResult, linksResult] = await Promise.all([
      this.client.from("form_version_fields").select().eq("form_version_id", versionId).order("sort_order"),
      this.client.from("form_rules").select().eq("form_version_id", versionId).order("sort_order"),
      this.client.from("form_service_links").select().eq("form_version_id", versionId).order("sort_order"),
    ]);
    if (fieldsResult.error) throw mapDatabaseError(fieldsResult.error, "Form fields");
    if (rulesResult.error) throw mapDatabaseError(rulesResult.error, "Form rules");
    if (linksResult.error) throw mapDatabaseError(linksResult.error, "Form Service links");
    const fields = (fieldsResult.data ?? []) as FormVersionFieldRow[];
    const optionsResult = fields.length
      ? await this.client.from("form_field_options").select().in("form_version_field_id", fields.map((field) => field.id)).order("sort_order")
      : { data: [], error: null };
    if (optionsResult.error) throw mapDatabaseError(optionsResult.error, "Form options");
    const options = (optionsResult.data ?? []) as FormFieldOptionRow[];
    const links = (linksResult.data ?? []) as FormServiceLinkRow[];
    return {
      form_id: form.id,
      form_type: form.form_type,
      canonical_key: form.canonical_key,
      form_version_id: version.id,
      version_number: version.version_number,
      schema_hash: version.schema_hash,
      title: version.title,
      information_html: version.information_html,
      visibility: version.visibility,
      type_config: asObject(version.type_config),
      fields: fields.map((field) => ({
        stable_field_key: field.stable_field_key,
        sort_order: field.sort_order,
        field_type: field.field_type,
        label: field.label,
        placeholder: field.placeholder,
        help_html: field.help_html,
        default_value: field.default_value,
        required: field.required,
        settings: asObject(field.settings),
        options: options.filter((option) => option.form_version_field_id === field.id).map((option) => ({
          option_id: option.stable_option_key,
          value: option.option_value,
          label: option.label,
          sort_order: option.sort_order,
          metadata: asObject(option.metadata),
        })),
        services: links.filter((link) => link.form_version_field_id === field.id).map((link) => ({
          service_id: link.service_id,
          role: link.role,
          sort_order: link.sort_order,
          configuration: asObject(link.configuration),
          name: link.service_name_snapshot,
          currency: link.service_currency_snapshot,
          price_cents: link.service_price_cents_snapshot,
        })),
      })),
      rules: ((rulesResult.data ?? []) as FormRuleRow[]).map((rule) => ({
        rule_key: rule.rule_key,
        sort_order: rule.sort_order,
        conditions: rule.conditions as FormPublishedSchema["rules"][number]["conditions"],
        action: rule.action,
        target_field_keys: rule.target_field_keys as string[],
      })),
    };
  }

  async create(input: CreateFormInput): Promise<FormRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_create_form", {
        p_request_id: requestId,
        p_payload: asJson(payload),
      }),
      "Form",
    ) as FormRow;
  }

  async updateDraft(id: string, input: UpdateFormDraftInput): Promise<FormVersionRow> {
    return unwrapOne(
      await this.client.rpc("app_update_form_draft", {
        p_request_id: input.request_id,
        p_form_id: id,
        p_definition: asJson(input.definition),
      }),
      "Form draft",
    ) as FormVersionRow;
  }

  async publish(id: string, requestId: string): Promise<FormVersionRow> {
    return unwrapOne(
      await this.client.rpc("app_publish_form", { p_request_id: requestId, p_form_id: id }),
      "Form version",
    ) as FormVersionRow;
  }

  async archive(id: string, requestId: string): Promise<FormRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_form", { p_request_id: requestId, p_form_id: id }),
      "Form",
    ) as FormRow;
  }

  async assign(id: string, input: AssignFormInput): Promise<FormAssignmentRow> {
    return unwrapOne(
      await this.client.rpc("app_assign_form", {
        p_request_id: input.request_id,
        p_form_id: id,
        p_context: asJson(input.context),
      }),
      "Form assignment",
    ) as FormAssignmentRow;
  }

  async submit(input: SubmitFormInput): Promise<FormSubmissionRow> {
    return unwrapOne(
      await this.client.rpc("app_submit_form", {
        p_request_id: input.request_id,
        p_form_version_id: input.form_version_id,
        p_context: asJson(input.context),
        p_values: asJson(input.values),
        p_files: asJson(input.files),
      }),
      "Form submission",
    ) as FormSubmissionRow;
  }

  async correct(
    submissionId: string,
    input: CorrectFormSubmissionInput,
  ): Promise<FormSubmissionRow> {
    return unwrapOne(
      await this.client.rpc("app_correct_form_submission", {
        p_request_id: input.request_id,
        p_submission_id: submissionId,
        p_values: asJson(input.values),
      }),
      "Form submission",
    ) as FormSubmissionRow;
  }

  async getPublishedSchema(canonicalKey: string): Promise<FormPublishedSchema> {
    const result = await this.client.rpc("app_get_published_form_schema", {
      p_canonical_key: canonicalKey,
    });
    if (result.error) throw mapDatabaseError(result.error, "Published Form");
    return result.data as unknown as FormPublishedSchema;
  }

  async listAssignments(): Promise<FormAssignmentSummary[]> {
    const result = await this.client.rpc("app_list_assigned_forms");
    if (result.error) throw mapDatabaseError(result.error, "Form assignments");
    return (result.data ?? []) as unknown as FormAssignmentSummary[];
  }

  async getAssignedForm(id: string): Promise<AssignedFormDetail> {
    const result = await this.client.rpc("app_get_assigned_form_schema", { p_assignment_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Assigned Form");
    return result.data as unknown as AssignedFormDetail;
  }

  async listSubmissions(formId?: string): Promise<FormSubmissionSummary[]> {
    let query = this.client.from("form_submissions").select().order("submitted_at", { ascending: false });
    if (formId) query = query.eq("form_id", formId);
    const result = await query;
    if (result.error) throw mapDatabaseError(result.error, "Form submissions");
    return (result.data ?? []) as unknown as FormSubmissionSummary[];
  }

  async getSubmission(id: string): Promise<FormSubmissionDetail> {
    const result = await this.client.rpc("app_get_form_submission", { p_submission_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Form submission");
    return result.data as unknown as FormSubmissionDetail;
  }
}
