-- pg_cron is already required by the deployed web-push migrations. This job
-- performs bounded database work only; it makes no HTTP/serverless requests.
do $migration$
declare existing record;
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise exception 'The existing pg_cron extension is required for order start retries'; end if;
  select * into existing from cron.job where jobname='wf-client-order-start-v1';
  if found then
    if existing.command<>'select private.process_requested_order_starts()' or existing.schedule<>'* * * * *' then
      raise exception 'Order start retry job conflicts with an existing job'; end if;
  else
    perform cron.schedule('wf-client-order-start-v1','* * * * *','select private.process_requested_order_starts()');
  end if;
end;
$migration$;
