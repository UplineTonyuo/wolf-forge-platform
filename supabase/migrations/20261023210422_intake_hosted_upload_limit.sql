-- Leave multipart overhead below Vercel's 4.5 MB Function request limit.
update storage.buckets set file_size_limit=4194304 where id='intake-files';
alter table private.intake_uploads add constraint intake_uploads_hosted_size check(size_bytes<=4194304);
