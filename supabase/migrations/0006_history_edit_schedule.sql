-- 家庭點點樂 v1.3：管理員從回顧修正紀錄、例行任務可設時間與指定日期、孩子提案每日例行需審核

-- 1) 欄位
alter table public.task_templates add column if not exists at_time time;
alter table public.task_templates add column if not exists dates date[] not null default '{}';
alter table public.tasks add column if not exists plan jsonb;
alter table public.ledger add column if not exists ref_ledger bigint;
create index if not exists ledger_ref_ledger_idx on public.ledger(ref_ledger);
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('todo','submitted','approved','rejected','void'));

create or replace function private.require_admin() returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare m public.members;
begin
  select * into m from public.members where id = (select auth.uid());
  if m.id is null or m.role <> 'admin' then raise exception '只有管理員可以修改紀錄'; end if;
  return m;
end $$;

-- 2) 產生例行任務：指定日期優先，否則看星期；有時間點就帶入截止時間
create or replace function private.generate_routines(p_family uuid, p_date date) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.tasks(family_id, template_id, kind, title, emoji, points, pack, photo, assignee, for_date, due_at)
  select t.family_id, t.id, 'routine', t.title, t.emoji, t.points, t.pack, t.photo, t.assignee, p_date,
         case when t.at_time is not null then (p_date + t.at_time) at time zone 'Asia/Taipei' end
    from public.task_templates t
   where t.active and (p_family is null or t.family_id = p_family)
     and (case when cardinality(t.dates) > 0 then p_date = any(t.dates) else extract(dow from p_date)::int = any(t.days) end)
  on conflict (template_id, for_date) do nothing;
  get diagnostics n = row_count; return n;
end $$;

create or replace function private.days_of(p jsonb, fallback int[]) returns int[]
language sql immutable set search_path = '' as
$$ select coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p) x), fallback) $$;
create or replace function private.dates_of(p jsonb) returns date[]
language sql immutable set search_path = '' as
$$ select coalesce((select array_agg(distinct x::date) from jsonb_array_elements_text(p) x where x <> ''), '{}') $$;

create or replace function public.save_template(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; tid uuid := nullif(p->>'id','')::uuid; d int[]; ds date[]; tm time;
begin
  me := private.require_parent();
  if not exists (select 1 from public.members where id = (p->>'assignee')::uuid and family_id = me.family_id) then raise exception '找不到這位成員'; end if;
  if length(trim(coalesce(p->>'title',''))) = 0 then raise exception '請填任務名稱'; end if;
  d := private.days_of(p->'days', '{0,1,2,3,4,5,6}');
  ds := private.dates_of(p->'dates');
  tm := nullif(p->>'at_time','')::time;
  if cardinality(ds) = 0 and cardinality(d) = 0 then raise exception '請選星期或指定日期'; end if;
  if tid is null then
    insert into public.task_templates(family_id, assignee, title, emoji, points, pack, days, dates, at_time, photo, active, sort)
    values (me.family_id, (p->>'assignee')::uuid, trim(p->>'title'), coalesce(p->>'emoji','✅'), (p->>'points')::int, nullif(p->>'pack',''),
            d, ds, tm, coalesce(p->>'photo','none'), coalesce((p->>'active')::boolean,true), 99)
    returning id into tid;
  else
    update public.task_templates set assignee = (p->>'assignee')::uuid, title = trim(p->>'title'), emoji = coalesce(p->>'emoji','✅'), points = (p->>'points')::int,
      pack = nullif(p->>'pack',''), days = d, dates = ds, at_time = tm,
      photo = coalesce(p->>'photo','none'), active = coalesce((p->>'active')::boolean,true)
    where id = tid and family_id = me.family_id;
    update public.tasks set title = trim(p->>'title'), emoji = coalesce(p->>'emoji','✅'), points = (p->>'points')::int, photo = coalesce(p->>'photo','none'),
           pack = nullif(p->>'pack',''), due_at = case when tm is not null then (for_date + tm) at time zone 'Asia/Taipei' end, reminded_at = null
     where template_id = tid and status = 'todo' and for_date = private.today();
  end if;
  perform private.generate_routines(me.family_id, private.today());
  return tid;
end $$;

-- 3) 到時間提醒：交辦前 1 小時、有設時間的例行任務前 15 分鐘
create or replace function private.errand_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  for t in select * from public.tasks where status in ('todo','rejected') and reminded_at is null and (
        (kind = 'errand' and due_at between now() and now() + interval '1 hour')
     or (kind = 'routine' and due_at between now() and now() + interval '15 minutes')) loop
    if t.kind = 'errand' then
      perform private.notify(t.assignee, '交辦快到期', '「' || t.title || '」' || to_char(t.due_at at time zone 'Asia/Taipei','HH24:MI') || ' 前要完成', '/');
    else
      perform private.notify(t.assignee, '⏰ ' || to_char(t.due_at at time zone 'Asia/Taipei','HH24:MI') || ' 要做的事', t.emoji || ' ' || t.title, '/');
    end if;
    update public.tasks set reminded_at = now() where id = t.id;
  end loop;
end $$;

-- 4) 孩子提案：可以是一次性，也可以是「每日例行」（核准後變成例行任務）
create or replace function public.propose_task(p_title text, p_emoji text, p_points int, p_plan jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; cnt int; lim int; tid uuid; pl jsonb; d int[]; ds date[]; msg text;
begin
  me := private.require_child();
  if length(trim(coalesce(p_title,''))) = 0 then raise exception '請寫要做什麼'; end if;
  lim := coalesce(private.setting(me.family_id,'proposal_daily_limit'),3)::int;
  select count(*) into cnt from public.tasks where assignee = me.id and kind = 'proposal'
     and (created_at at time zone 'Asia/Taipei')::date = private.today();
  if cnt >= lim then raise exception '今天的提案次數用完了，明天再來'; end if;
  if p_plan is not null then
    if p_points < 1 or p_points > 50 then raise exception '例行任務建議點數要在 1 到 50 之間'; end if;
    d := private.days_of(p_plan->'days', '{0,1,2,3,4,5,6}'); ds := private.dates_of(p_plan->'dates');
    if cardinality(d) = 0 and cardinality(ds) = 0 then raise exception '請選要做的日子'; end if;
    pl := jsonb_build_object('days', to_jsonb(d), 'dates', to_jsonb(ds), 'at_time', nullif(p_plan->>'at_time',''), 'pack', nullif(p_plan->>'pack',''));
    msg := me.display_name || '想把「' || trim(p_title) || '」加入例行任務，每次 ' || p_points || ' 點';
  else
    if p_points < 5 or p_points > 200 then raise exception '建議點數要在 5 到 200 之間'; end if;
    msg := me.display_name || '想做「' || trim(p_title) || '」，建議 ' || p_points || ' 點';
  end if;
  insert into public.tasks(family_id, kind, title, emoji, points, assignee, created_by, status, submitted_at, plan)
  values (me.family_id, 'proposal', trim(p_title), coalesce(p_emoji,'💡'), p_points, me.id, me.id, 'submitted', now(), pl) returning id into tid;
  perform private.notify_parents(me.family_id, case when pl is null then '新的主動提案' else '新的例行任務提案' end, msg, '/?tab=queue');
  return tid;
end $$;

-- 5) 核准：例行提案核准後建立例行任務（不直接給點，之後每天做完再核准給點）
create or replace function public.decide_task(p_task uuid, p_approve boolean, p_points int default null, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks; pts int; bonus int := 0; label text; tm time;
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and family_id = me.family_id for update;
  if t.id is null or t.status <> 'submitted' then raise exception '這個任務已經處理過了'; end if;
  if not p_approve then
    update public.tasks set status = 'rejected', reject_reason = coalesce(nullif(trim(p_reason),''),'再試一次'), decided_by = me.id, decided_at = now() where id = t.id;
    perform private.notify(t.assignee, case when t.plan is not null then '例行提案沒有通過' else '任務被退回' end, '「' || t.title || '」：' || coalesce(nullif(trim(p_reason),''),'再試一次'), '/');
    return 0;
  end if;
  if t.kind = 'proposal' and t.plan is not null then
    pts := least(greatest(coalesce(p_points, t.points), 1), 50);
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

-- 6) 管理員撤銷：誤按通過時，收回點數並退回重做（redo）或作廢（void）
create or replace function public.admin_redo_task(p_task uuid, p_mode text default 'redo', p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks; back int := 0; n int; why text;
begin
  me := private.require_admin();
  if p_mode not in ('redo','void') then raise exception '動作不正確'; end if;
  select * into t from public.tasks where id = p_task and family_id = me.family_id for update;
  if t.id is null then raise exception '找不到這個任務'; end if;
  if t.status = 'void' then raise exception '這個任務已經作廢了'; end if;
  if t.plan is not null and t.status = 'approved' then raise exception '例行提案已經變成例行任務，請到「任務獎勵」修改或刪除'; end if;
  why := coalesce(nullif(trim(p_reason),''), case when p_mode = 'redo' then '還沒完成，請再做一次' else '這項不算' end);
  -- 收回這個任務的點數（含修改過的部分），全勤獎分開沖銷，之後重新核准還能再拿
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
  select family_id, member_id, account, -sum(amount),
         case when bool_or(ref_type = 'pack' or reason like '%全勤獎') then '撤銷：全勤獎' else '撤銷：' || t.title end, 'undo', ref_id, me.id
    from public.ledger where ref_id = t.id and ref_type in ('task','pack','undo','adjust')
   group by family_id, member_id, account, ref_id, (ref_type = 'pack' or reason like '%全勤獎') having sum(amount) <> 0;
  -- 同一組例行如果因為這項拿過全勤獎（記在別的任務上），也一起收回
  if t.kind = 'routine' and t.pack is not null then
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
    select l.family_id, l.member_id, l.account, -sum(l.amount), '撤銷：全勤獎', 'undo', l.ref_id, me.id
      from public.ledger l join public.tasks x on x.id = l.ref_id
     where x.assignee = t.assignee and x.for_date = t.for_date and x.pack = t.pack and x.id <> t.id
       and l.ref_type in ('pack','undo','adjust') and l.reason like '%全勤獎'
     group by l.family_id, l.member_id, l.account, l.ref_id having sum(l.amount) <> 0;
  end if;
  select coalesce(-sum(amount),0) into back from public.ledger where ref_type = 'undo' and created_by = me.id and created_at = now() and member_id = t.assignee;
  update public.tasks set status = case when p_mode = 'redo' then 'todo' else 'void' end,
         reject_reason = why, submitted_at = null, decided_at = now(), decided_by = me.id,
         ack_at = case when p_mode = 'redo' then null else ack_at end, nag_at = null, reminded_at = null
   where id = t.id;
  get diagnostics n = row_count;
  perform private.notify(t.assignee, case when p_mode = 'redo' then '任務要再做一次' else '任務已作廢' end,
    '「' || t.title || '」：' || why || case when back > 0 then '（收回 ' || back || ' 點）' else '' end, '/');
  return back;
end $$;

-- 7) 管理員修改或刪除一筆點數（帳本只新增修正紀錄，不改原紀錄）
create or replace function public.admin_edit_ledger(p_id bigint, p_amount int, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; l public.ledger; cur int; delta int; label text;
begin
  me := private.require_admin();
  select * into l from public.ledger where id = p_id and family_id = me.family_id;
  if l.id is null then raise exception '找不到這筆紀錄'; end if;
  if l.ref_ledger is not null then raise exception '這是修正紀錄，請改原本那筆'; end if;
  if l.account <> 'spend' or l.ref_type not in ('task','pack','bonus') then raise exception '這種紀錄不能修改（兌換、存錢罐請用原本的流程處理）'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000 then raise exception '點數要在 0 到 1000 之間'; end if;
  select l.amount + coalesce(sum(amount),0) into cur from public.ledger where ref_ledger = l.id;
  delta := p_amount - cur;
  if delta = 0 then return cur; end if;
  label := case when p_amount = 0 then '刪除：' else '修改：' end || l.reason;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, ref_ledger, created_by)
  values (l.family_id, l.member_id, 'spend', delta, label, 'adjust', l.ref_id, l.id, me.id);
  perform private.notify(l.member_id, case when p_amount = 0 then '一筆點數被刪除' else '點數已修正' end,
    '「' || l.reason || '」' || cur || ' → ' || p_amount || ' 點' || coalesce('：' || nullif(trim(p_reason),''), ''), '/?tab=history');
  return p_amount;
end $$;

-- 8) 等級計算包含修正紀錄；交辦取消、重審也把修正過的點數算進去
create or replace function public.get_wallet(p_member uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare me public.members; target public.members; lvp int; life int; r json;
begin
  me := private.me();
  select * into target from public.members where id = coalesce(p_member, me.id);
  if target.family_id is distinct from me.family_id then raise exception '找不到這位成員'; end if;
  if me.role not in ('admin','parent') and target.id <> me.id then raise exception '只能看自己的點數'; end if;
  lvp := coalesce(private.setting(target.family_id,'level_points'),300)::int;
  select coalesce(sum(amount),0) into life from public.ledger
   where member_id = target.id and ref_type in ('task','pack','bonus','interest','deposit_bonus','undo','adjust');
  select json_build_object(
    'member_id', target.id,
    'spend', private.spend_balance(target.id),
    'jar_raw', coalesce((select sum(amount) from public.jar_lots where member_id = target.id),0),
    'jar_value', coalesce((select round(sum(amount * public.jar_mult(extract(day from now()-deposited_at)::int))) from public.jar_lots where member_id = target.id),0),
    'best_days', coalesce((select max(extract(day from now()-deposited_at)::int) from public.jar_lots where member_id = target.id),0),
    'lifetime', greatest(life,0), 'level', greatest(life,0) / lvp + 1, 'level_points', lvp,
    'lots', coalesce((select json_agg(json_build_object('id',id,'amount',amount,'days',extract(day from now()-deposited_at)::int) order by deposited_at) from public.jar_lots where member_id = target.id),'[]'::json)
  ) into r;
  return r;
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
    from public.ledger where ref_id = t.id and ref_type in ('task','undo','adjust')
   group by family_id, member_id, account, ref_id having sum(amount) <> 0;
  update public.tasks set status = 'todo', submitted_at = null, decided_at = null, decided_by = null, reject_reason = why,
         ack_at = null, nag_at = null, reminded_at = null where id = t.id;
  if t.assignee <> me.id then
    perform private.notify(t.assignee, '交辦需要重做', '「' || t.title || '」：' || why, '/');
  end if;
end $$;


grant execute on function public.propose_task(text, text, int, jsonb), public.admin_redo_task(uuid, text, text), public.admin_edit_ledger(bigint, int, text) to authenticated;
