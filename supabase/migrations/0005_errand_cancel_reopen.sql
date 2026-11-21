-- 家庭點點樂：取消交辦、重審交辦
-- 取消：還沒給點數的交辦可以直接取消
create or replace function public.cancel_errand(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks; given int;
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and family_id = me.family_id and kind = 'errand' for update;
  if t.id is null then raise exception '找不到這個交辦'; end if;
  select coalesce(sum(amount),0) into given from public.ledger where ref_id = t.id and ref_type in ('task','undo');
  if given <> 0 then raise exception '這個交辦已經給過點數，請改用「重審」收回'; end if;
  delete from public.tasks where id = t.id;
  if t.assignee <> me.id then
    perform private.notify(t.assignee, '交辦已取消', me.display_name || '取消了「' || t.title || '」，不用做了', '/');
  end if;
end $$;

-- 重審：把已完成、待核准或退回的交辦打回「進行中」，已給的點數自動收回
create or replace function public.reopen_errand(p_task uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks; why text := coalesce(nullif(trim(p_reason),''), '需要再做一次');
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and family_id = me.family_id and kind = 'errand' for update;
  if t.id is null then raise exception '找不到這個交辦'; end if;
  if t.status = 'todo' then raise exception '這個交辦還在進行中'; end if;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
  select family_id, member_id, account, -sum(amount), '重審收回：' || t.title, 'undo', ref_id, me.id
    from public.ledger where ref_id = t.id and ref_type in ('task','undo')
   group by family_id, member_id, account, ref_id having sum(amount) <> 0;
  update public.tasks set status = 'todo', submitted_at = null, decided_at = null, decided_by = null, reject_reason = why,
         ack_at = null, nag_at = null, reminded_at = null where id = t.id;
  if t.assignee <> me.id then
    perform private.notify(t.assignee, '交辦需要重做', '「' || t.title || '」：' || why, '/');
  end if;
end $$;

revoke execute on function public.cancel_errand, public.reopen_errand from anon, public;
grant execute on function public.cancel_errand, public.reopen_errand to authenticated;
