-- 家庭點點樂 v1.5：修正撤銷後再刪除會重複扣點、例行任務只由管理員審核、核准時評價
alter table public.tasks add column if not exists rating text;

create or replace function public.decide_task(p_task uuid, p_approve boolean, p_points int default null, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks; pts int; bonus int := 0; label text; tm time; cap int;
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and family_id = me.family_id for update;
  if t.id is null or t.status <> 'submitted' then raise exception '這個任務已經處理過了'; end if;
  if t.kind = 'routine' and me.role <> 'admin' then raise exception '例行任務要由管理員審核'; end if;
  if not p_approve then
    update public.tasks set status = 'rejected', reject_reason = coalesce(nullif(trim(p_reason),''),'再試一次'), decided_by = me.id, decided_at = now() where id = t.id;
    perform private.notify(t.assignee, case when t.plan is not null then '例行提案沒有通過' else '任務被退回' end, '「' || t.title || '」：' || coalesce(nullif(trim(p_reason),''),'再試一次'), '/');
    return 0;
  end if;
  if t.kind = 'proposal' and t.plan is not null then
    pts := least(greatest(coalesce(p_points, t.points), 1), 100);
    tm := nullif(t.plan->>'at_time','')::time;
    insert into public.task_templates(family_id, assignee, title, emoji, points, pack, days, dates, at_time, photo, active, sort)
    values (t.family_id, t.assignee, t.title, t.emoji, pts, nullif(t.plan->>'pack',''),
            private.days_of(t.plan->'days', '{0,1,2,3,4,5,6}'), private.dates_of(t.plan->'dates'), tm, 'none', true, 99);
    update public.tasks set status = 'approved', points = pts, decided_by = me.id, decided_at = now() where id = t.id;
    perform private.generate_routines(t.family_id, private.today());
    perform private.notify(t.assignee, '例行任務通過了 🎉', me.display_name || '把「' || t.title || '」加入你的例行任務，每次 ' || pts || ' 點', '/');
    return 0;
  end if;
  pts := coalesce(p_points, t.points);
  cap := 1000; if t.kind = 'errand' then cap := 5000; elsif t.kind = 'routine' then cap := 100; end if;
  if pts < 0 or pts > cap then raise exception '點數超過上限'; end if;
  if t.kind = 'proposal' then pts := round(pts * (1 + coalesce(private.setting(t.family_id,'proposal_bonus'),0.2))); end if;
  update public.tasks set status = 'approved', points = coalesce(p_points, t.points), decided_by = me.id, decided_at = now() where id = t.id;
  label := case t.kind when 'proposal' then '主動任務：' when 'errand' then '交辦：' else '' end || t.title;
  if pts > 0 then
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
    values (t.family_id, t.assignee, 'spend', pts, label, 'task', t.id, me.id);
  end if;
  if t.kind = 'routine' and t.pack is not null and not exists (
       select 1 from public.tasks where assignee = t.assignee and for_date = t.for_date and pack = t.pack and kind = 'routine' and status not in ('approved','void'))
     and coalesce((select sum(l.amount) from public.ledger l join public.tasks x on x.id = l.ref_id
        where l.member_id = t.assignee and l.ref_type in ('pack','undo','adjust') and l.reason like '%全勤獎' and x.for_date = t.for_date and x.pack = t.pack), 0) <= 0 then
    bonus := coalesce(private.setting(t.family_id,'pack_bonus'),10)::int;
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
    values (t.family_id, t.assignee, 'spend', bonus, '全勤獎', 'pack', t.id, me.id);
  end if;
  perform private.notify(t.assignee, '任務核准 +' || (pts + bonus), me.display_name || '核准了「' || t.title || '」' || case when bonus > 0 then '，全勤再加 ' || bonus else '' end, '/');
  return pts + bonus;
end $$;

create or replace function public.admin_edit_ledger(p_id bigint, p_amount int, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; l public.ledger; cur int; delta int; label text;
begin
  me := private.require_admin();
  select * into l from public.ledger where id = p_id and family_id = me.family_id;
  if l.id is null then raise exception '找不到這筆紀錄'; end if;
  if l.ref_ledger is not null then raise exception '這是修正紀錄，請改原本那筆'; end if;
  if l.account <> 'spend' or l.ref_type not in ('task','pack','bonus') then raise exception '這種紀錄不能修改（兌換、存錢罐請用原本的流程處理）'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 5000 then raise exception '點數要在 0 到 5000 之間'; end if;
  -- 任務和全勤獎：以這個任務目前實際拿到的點數為準（含撤銷、修改），避免重複扣
  if l.ref_id is not null and l.ref_type in ('task','pack') then
    select coalesce(sum(amount),0) into cur from public.ledger
     where ref_id = l.ref_id and member_id = l.member_id and account = 'spend' and ref_type in ('task','pack','undo','adjust')
       and ((ref_type = 'pack' or reason like '%全勤獎') = (l.ref_type = 'pack'));
  else
    select l.amount + coalesce(sum(amount),0) into cur from public.ledger where ref_ledger = l.id;
  end if;
  delta := p_amount - cur;
  if delta = 0 then
    if cur = 0 then raise exception '這筆點數已經收回了'; end if;
    return cur;
  end if;
  label := case when p_amount = 0 then '刪除：' else '修改：' end || l.reason;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, ref_ledger, created_by)
  values (l.family_id, l.member_id, 'spend', delta, label, 'adjust', l.ref_id, l.id, me.id);
  perform private.notify(l.member_id, case when p_amount = 0 then '一筆點數被刪除' else '點數已修正' end,
    '「' || l.reason || '」' || cur || ' → ' || p_amount || ' 點' || coalesce('：' || nullif(trim(p_reason),''), ''), '/?tab=history');
  return p_amount;
end $$;

-- 核准並評價（例行任務只有管理員可以審核）
create or replace function public.approve_task(p_task uuid, p_points int default null, p_rating text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks; r int; rt text := nullif(trim(coalesce(p_rating,'')),'');
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and family_id = me.family_id;
  if t.id is null then raise exception '找不到這個任務'; end if;
  if rt is not null and length(rt) > 20 then raise exception '評價太長了'; end if;
  r := public.decide_task(p_task, true, p_points, null);
  if rt is not null then
    update public.tasks set rating = rt where id = p_task;
    if t.assignee <> me.id then perform private.notify(t.assignee, '評價：' || rt, me.display_name || '對「' || t.title || '」的評價', '/?tab=history'); end if;
  end if;
  return r;
end $$;
grant execute on function public.approve_task(uuid, int, text) to authenticated;

-- 更正：11/24 同一筆「寫閱讀報報」60 點先撤銷又刪除，被扣了兩次，補回多扣的 60 點
insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, ref_ledger, created_by)
select family_id, member_id, 'spend', 60, '更正：重複扣除的點數補回', 'adjust', ref_id, 39, null
  from public.ledger where id = 58 and amount = -60 and ref_ledger = 39
   and not exists (select 1 from public.ledger where ref_ledger = 39 and reason like '更正：%');
