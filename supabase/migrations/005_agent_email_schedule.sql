-- ---------------------------------------------------------------------------
-- 005_agent_email_schedule.sql  (ADDITIVE ONLY)
--
-- 1. Approver agent explanation column (the AI explains; the rules in 004 decide).
-- 2. Functions the send-notifications Edge Function uses (service role only).
-- 3. Schedules with pg_cron + pg_net:
--      every 5 minutes  -> call send-notifications when e-mails are queued
--      Monday 13:00 UTC -> queue the weekly sales head report (08:00 US Eastern in winter)
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. AI explanation ----------------------------------------------------------
alter table ops.sales_order_ext add column if not exists ai_explanation text;

create or replace function api.add_review_explanation(p_sales_order_id text, p_explanation text)
returns ops.sales_order_ext
language plpgsql security definer set search_path = '' as $$
declare v_ext ops.sales_order_ext;
begin
  if api.current_erp_role() is distinct from 'operator' then
    raise exception 'NOT_ALLOWED: only operators can run the approver' using errcode = '42501';
  end if;
  update ops.sales_order_ext set ai_explanation = left(btrim(p_explanation), 800)
   where sales_order_id = p_sales_order_id
  returning * into v_ext;
  if not found then raise exception 'UNKNOWN_SO: % has no agent record', p_sales_order_id using errcode = '22023'; end if;
  update ops.agent_runs set output = output || jsonb_build_object('ai_explanation', left(btrim(p_explanation), 800))
   where run_id = (select max(run_id) from ops.agent_runs where agent = 'Approver agent' and sales_order_id = p_sales_order_id);
  return v_ext;
end;
$$;
revoke all on function api.add_review_explanation(text, text) from public, anon;
grant execute on function api.add_review_explanation(text, text) to authenticated;

create or replace view api.sales_order_approvals with (security_invoker = true) as
  select e.sales_order_id, s.sku, s.warehouse_id, s.order_qty, s.shipped_qty, s.order_date, s.status,
         e.account_id, c.account_name, e.unit_price, e.amount, e.requested_by, e.request_text,
         e.stock_status, e.available_at_check, e.approval_status, e.decided_by, e.decision_reason,
         e.created_at, e.decided_at, e.ai_explanation
  from ops.sales_order_ext e
  join raw.sales_orders s using (sales_order_id)
  left join ops.customers c on c.account_id = e.account_id;

-- 2. E-mail sending (called by the Edge Function with the service role) -------
select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'erp_cron_secret',
                           'Shared secret: pg_cron -> send-notifications Edge Function')
where not exists (select 1 from vault.secrets where name = 'erp_cron_secret');

create or replace function api.verify_cron_secret(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_secret, '') <> ''
     and exists (select 1 from vault.decrypted_secrets where name = 'erp_cron_secret' and decrypted_secret = p_secret)
$$;

-- Fills in recipients from ops.settings, then returns up to 20 e-mails to send.
create or replace function api.claim_notifications()
returns table (notification_id bigint, kind text, recipient text, sender text, subject text, body_html text)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'NOT_ALLOWED: service role only' using errcode = '42501';
  end if;
  update ops.notifications n
     set recipient = nullif(ops.setting(case n.kind when 'Shortage alert' then 'inventory_team_email' else 'sales_head_email' end), '')
   where n.status = 'Queued' and n.recipient is null;
  return query
    select n.notification_id, n.kind, n.recipient, ops.setting('email_from'), n.subject, n.body_html
      from ops.notifications n
     where n.status = 'Queued' and n.recipient is not null and n.attempts < 5
     order by n.notification_id
     limit 20;
end;
$$;

create or replace function api.mark_notification(p_notification_id bigint, p_sent boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'NOT_ALLOWED: service role only' using errcode = '42501';
  end if;
  update ops.notifications
     set attempts = attempts + 1,
         status = case when p_sent then 'Sent' when attempts + 1 >= 5 then 'Failed' else 'Queued' end,
         sent_at = case when p_sent then now() else sent_at end,
         error = case when p_sent then null else left(p_error, 500) end
   where notification_id = p_notification_id;
end;
$$;

revoke all on function api.verify_cron_secret(text) from public, anon, authenticated;
revoke all on function api.claim_notifications() from public, anon, authenticated;
revoke all on function api.mark_notification(bigint, boolean, text) from public, anon, authenticated;
-- The Edge Function's service-role client needs the api schema (only these 3 functions are granted).
grant usage on schema api to service_role;
grant execute on function api.verify_cron_secret(text) to service_role;
grant execute on function api.claim_notifications() to service_role;
grant execute on function api.mark_notification(bigint, boolean, text) to service_role;

-- 3. Schedules ----------------------------------------------------------------
create or replace function ops.kick_send_notifications() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from ops.notifications where status = 'Queued' and attempts < 5)
     and (exists (select 1 from ops.notifications where status = 'Queued' and recipient is not null)
          or coalesce(ops.setting('inventory_team_email'), '') <> '' or coalesce(ops.setting('sales_head_email'), '') <> '') then
    perform net.http_post(
      url := 'https://epvnsalihzmnrkqcxkoc.supabase.co/functions/v1/send-notifications',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'erp_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000);
  end if;
end;
$$;
revoke all on function ops.kick_send_notifications() from public, anon, authenticated;

select cron.schedule('erp-send-notifications', '*/5 * * * *', 'select ops.kick_send_notifications()');
select cron.schedule('erp-weekly-sales-report', '0 13 * * 1', 'select ops.queue_weekly_sales_report()');
