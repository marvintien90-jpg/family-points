-- 家庭點點樂：刪除例行任務與獎勵、交辦「收到」確認、未確認每 3 小時提醒
alter table public.tasks add column if not exists ack_at timestamptz, add column if not exists nag_at timestamptz;
update public.tasks set ack_at = coalesce(submitted_at, decided_at, created_at) where kind = 'errand' and status <> 'todo' and ack_at is null;

-- 刪除例行任務：今天還沒做的那一項一起移除，已完成的歷史紀錄保留
create or replace function public.delete_template(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.require_parent();
  if not exists (select 1 from public.task_templates where id = p_id and family_id = me.family_id) then raise exception '找不到這個任務'; end if;
  delete from public.tasks where template_id = p_id and status = 'todo';
  delete from public.task_templates where id = p_id and family_id = me.family_id;
end $$;

-- 刪除獎勵：已申請中的兌換照樣可以處理（兌換紀錄有存名稱和點數）
create or replace function public.delete_reward(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.require_parent();
  if not exists (select 1 from public.rewards where id = p_id and family_id = me.family_id) then raise exception '找不到這個獎勵'; end if;
  delete from public.rewards where id = p_id and family_id = me.family_id;
end $$;

-- 被交辦的人按「收到」
create or replace function public.ack_errand(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks;
begin
  me := private.me();
  select * into t from public.tasks where id = p_task and assignee = me.id and kind = 'errand';
  if t.id is null then raise exception '找不到這個交辦'; end if;
  if t.ack_at is not null then return; end if;
  update public.tasks set ack_at = now() where id = t.id;
  if t.created_by is not null and t.created_by <> me.id then
    perform private.notify(t.created_by, '交辦已收到', me.display_name || '收到了「' || t.title || '」', '/?tab=errands');
  end if;
end $$;

-- 交辦給自己、完成或提交時，自動視為已收到
create or replace function private.errand_auto_ack() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'errand' and new.ack_at is null and (new.assignee = new.created_by or new.status <> 'todo') then new.ack_at := now(); end if;
  return new;
end $$;
drop trigger if exists fp_errand_auto_ack on public.tasks;
create trigger fp_errand_auto_ack before insert or update on public.tasks
for each row execute function private.errand_auto_ack();

-- 每小時檢查：還沒按「收到」的交辦，每 3 小時提醒一次（台灣時間 08:00–21:00）
create or replace function private.errand_nag() returns void
language plpgsql security definer set search_path = '' as $$
declare t record; h int := extract(hour from now() at time zone 'Asia/Taipei')::int;
begin
  if h < 8 or h >= 21 then return; end if;
  for t in select * from public.tasks where kind = 'errand' and status = 'todo' and ack_at is null
      and coalesce(nag_at, created_at) <= now() - interval '3 hours' and created_at > now() - interval '14 days' loop
    perform private.notify(t.assignee, '有交辦還沒確認', '「' || t.title || '」' || coalesce('，' || to_char(t.due_at at time zone 'Asia/Taipei','MM/DD HH24:MI') || ' 前', '') || '，打開後按「收到」', '/');
    update public.tasks set nag_at = now() where id = t.id;
  end loop;
end $$;
select cron.schedule('fp-errand-nag', '2 * * * *', $$ select private.errand_nag() $$);

revoke execute on function public.delete_template, public.delete_reward, public.ack_errand from anon, public;
grant execute on function public.delete_template, public.delete_reward, public.ack_errand to authenticated;
revoke execute on function private.errand_nag, private.errand_auto_ack from anon, authenticated, public;
