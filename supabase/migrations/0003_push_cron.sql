-- 家庭點點樂：推播與排程
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 部署時在 Vault 放入：fp_functions_url（例如 https://xxx.supabase.co/functions/v1）與 fp_push_secret
create or replace function private.call_push(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u text; s text;
begin
  select decrypted_secret into u from vault.decrypted_secrets where name = 'fp_functions_url';
  select decrypted_secret into s from vault.decrypted_secrets where name = 'fp_push_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(url := u || '/send-push', body := payload,
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret', s), timeout_milliseconds := 8000);
end $$;

create or replace function private.on_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform private.call_push(jsonb_build_object('id', new.id)); return new; end $$;

create trigger fp_notification_push after insert on public.notifications
for each row execute function private.on_notification();

-- 排程（UTC）：每天台灣 00:05 產生例行任務；07:05 補送安靜時段累積的通知；週日 21:00 利息；每 10 分鐘交辦提醒
select cron.schedule('fp-daily-routines', '5 16 * * *', $$ select private.generate_routines(null, (now() at time zone 'Asia/Taipei')::date) $$);
select cron.schedule('fp-morning-flush', '5 23 * * *', $$ select private.call_push('{"flush":true}'::jsonb) $$);
select cron.schedule('fp-weekly-interest', '0 13 * * 0', $$ select private.weekly_interest() $$);
select cron.schedule('fp-errand-reminders', '*/10 * * * *', $$ select private.errand_reminders() $$);

-- 即時更新
alter publication supabase_realtime add table public.tasks, public.redemptions, public.notifications;

-- 推播函式從 Vault 讀金鑰（只有 service role 能呼叫）
create or replace function public.fp_push_config() returns json
language sql stable security definer set search_path = '' as $$
  select json_object_agg(name, decrypted_secret) from vault.decrypted_secrets
   where name in ('fp_push_secret','fp_vapid_public','fp_vapid_private','fp_vapid_subject')
$$;
revoke execute on function public.fp_push_config from anon, authenticated, public;
grant execute on function public.fp_push_config to service_role;
