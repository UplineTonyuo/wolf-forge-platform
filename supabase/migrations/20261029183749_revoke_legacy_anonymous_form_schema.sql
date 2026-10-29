begin;

-- Post-deploy only: first deploy and verify the cached server-only public reader.
revoke execute on function public.app_get_published_form_schema(text) from public, anon;

commit;
