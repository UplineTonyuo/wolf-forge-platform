-- Forms policies must call the safe permission resolver exposed to authenticated
-- roles. The private resolver remains non-executable outside SECURITY DEFINER
-- functions.

drop policy forms_internal_select on public.forms;
create policy forms_internal_select on public.forms for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));

drop policy form_versions_internal_select on public.form_versions;
create policy form_versions_internal_select on public.form_versions for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));

drop policy form_version_fields_internal_select on public.form_version_fields;
create policy form_version_fields_internal_select on public.form_version_fields for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));

drop policy form_field_options_internal_select on public.form_field_options;
create policy form_field_options_internal_select on public.form_field_options for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));

drop policy form_rules_internal_select on public.form_rules;
create policy form_rules_internal_select on public.form_rules for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));

drop policy form_service_links_internal_select on public.form_service_links;
create policy form_service_links_internal_select on public.form_service_links for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));

drop policy form_assignments_authorized_select on public.form_assignments;
create policy form_assignments_authorized_select on public.form_assignments for select to authenticated
using (
  ((select private.is_internal_user()) and (
    public.app_has_permission('forms.assign')
    or public.app_has_permission('forms.submissions_view')
  ))
  or ((select private.is_client_user()) and company_id = (select private.current_user_company_id()))
);

drop policy form_submissions_authorized_select on public.form_submissions;
create policy form_submissions_authorized_select on public.form_submissions for select to authenticated
using (
  ((select private.is_internal_user()) and public.app_has_permission('forms.submissions_view'))
  or ((select private.is_client_user()) and company_id = (select private.current_user_company_id()))
);

drop policy form_submission_values_internal_select on public.form_submission_values;
create policy form_submission_values_internal_select on public.form_submission_values for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.submissions_view'));

drop policy form_files_internal_select on public.form_files;
create policy form_files_internal_select on public.form_files for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.submissions_view'));
