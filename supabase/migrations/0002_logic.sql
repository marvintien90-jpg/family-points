-- 家庭點點樂：點數規則（所有寫入都經過這些函式，前端無法直接改點數）

create or replace function private.me() returns public.members
language sql stable security definer set search_path = '' as
$$ select * from public.members where id = (select auth.uid()) $$;

create or replace function private.setting(fid uuid, key text) returns numeric
language sql stable security definer set search_path = '' as
$$ select (settings->>key)::numeric from public.families where id = fid $$;

create or replace function private.today() returns date
language sql stable set search_path = '' as
$$ select (now() at time zone 'Asia/Taipei')::date $$;

create or replace function public.jar_mult(days int) returns numeric
language sql immutable set search_path = '' as
$$ select case when days >= 60 then 1.5 when days >= 30 then 1.25 when days >= 14 then 1.1 else 1.0 end $$;

create or replace function private.notify(p_member uuid, p_title text, p_body text, p_url text default '/')
returns void language sql security definer set search_path = '' as
$$ insert into public.notifications(family_id, member_id, title, body, url)
   select family_id, id, p_title, p_body, p_url from public.members where id = p_member $$;

create or replace function private.notify_parents(p_family uuid, p_title text, p_body text, p_url text default '/')
returns void language sql security definer set search_path = '' as
$$ insert into public.notifications(family_id, member_id, title, body, url)
   select family_id, id, p_title, p_body, p_url from public.members where family_id = p_family and role in ('admin','parent') $$;

create or replace function private.require_parent() returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare m public.members;
begin
  select * into m from public.members where id = (select auth.uid());
  if m.id is null or m.role not in ('admin','parent') then raise exception '只有家長可以做這件事'; end if;
  return m;
end $$;

create or replace function private.require_child() returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare m public.members;
begin
  select * into m from public.members where id = (select auth.uid());
  if m.id is null or m.role <> 'child' then raise exception '只有孩子可以做這件事'; end if;
  return m;
end $$;

create or replace function private.spend_balance(p_member uuid) returns int
language sql stable security definer set search_path = '' as
$$ select coalesce(sum(amount),0)::int from public.ledger where member_id = p_member and account = 'spend' $$;

-- 錢包摘要
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
   where member_id = target.id and ref_type in ('task','pack','bonus','interest','deposit_bonus','undo');
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

-- 產生今天的例行任務
create or replace function private.generate_routines(p_family uuid, p_date date) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.tasks(family_id, template_id, kind, title, emoji, points, pack, photo, assignee, for_date)
  select t.family_id, t.id, 'routine', t.title, t.emoji, t.points, t.pack, t.photo, t.assignee, p_date
    from public.task_templates t
   where t.active and (p_family is null or t.family_id = p_family) and extract(dow from p_date)::int = any(t.days)
  on conflict (template_id, for_date) do nothing;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.ensure_today() returns void
language plpgsql security definer set search_path = '' as $$
begin perform private.generate_routines(private.my_family(), private.today()); end $$;

-- 孩子提交任務（可一次多項）
create or replace function public.submit_tasks(p_ids uuid[], p_photo text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; n int; names text;
begin
  me := private.me();
  if me.id is null then raise exception '請先登入'; end if;
  if exists (select 1 from public.tasks where id = any(p_ids) and photo = 'required' and p_photo is null) then
    raise exception '這個任務需要附上照片'; end if;
  update public.tasks set status = 'submitted', submitted_at = now(), photo_path = coalesce(p_photo, photo_path), reject_reason = null
   where id = any(p_ids) and assignee = me.id and status in ('todo','rejected');
  get diagnostics n = row_count;
  if n = 0 then raise exception '沒有可以提交的任務'; end if;
  select string_agg(title, '、') into names from public.tasks where id = any(p_ids);
  perform private.notify_parents(me.family_id, '等你核准', me.display_name || '完成了「' || names || '」', '/?tab=queue');
  return n;
end $$;

-- 孩子主動提案
create or replace function public.propose_task(p_title text, p_emoji text, p_points int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; cnt int; lim int; tid uuid;
begin
  me := private.require_child();
  if length(trim(coalesce(p_title,''))) = 0 then raise exception '請寫要做什麼'; end if;
  if p_points < 5 or p_points > 200 then raise exception '建議點數要在 5 到 200 之間'; end if;
  lim := coalesce(private.setting(me.family_id,'proposal_daily_limit'),3)::int;
  select count(*) into cnt from public.tasks where assignee = me.id and kind = 'proposal'
     and (created_at at time zone 'Asia/Taipei')::date = private.today();
  if cnt >= lim then raise exception '今天的提案次數用完了，明天再來'; end if;
  insert into public.tasks(family_id, kind, title, emoji, points, assignee, created_by, status, submitted_at)
  values (me.family_id, 'proposal', trim(p_title), coalesce(p_emoji,'💡'), p_points, me.id, me.id, 'submitted', now()) returning id into tid;
  perform private.notify_parents(me.family_id, '新的主動提案', me.display_name || '想做「' || trim(p_title) || '」，建議 ' || p_points || ' 點', '/?tab=queue');
  return tid;
end $$;

-- 家長交辦
create or replace function public.create_errand(p_title text, p_emoji text, p_assignee uuid, p_due timestamptz, p_points int default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; tid uuid; who text;
begin
  me := private.require_parent();
  select display_name into who from public.members where id = p_assignee and family_id = me.family_id;
  if who is null then raise exception '找不到這位成員'; end if;
  if length(trim(coalesce(p_title,''))) = 0 then raise exception '請寫交辦內容'; end if;
  insert into public.tasks(family_id, kind, title, emoji, points, assignee, created_by, due_at)
  values (me.family_id, 'errand', trim(p_title), coalesce(p_emoji,'📌'), greatest(coalesce(p_points,0),0), p_assignee, me.id, p_due) returning id into tid;
  if p_assignee <> me.id then
    perform private.notify(p_assignee, '新的交辦事項', me.display_name || '交辦：「' || trim(p_title) || '」' ||
      coalesce('，' || to_char(p_due at time zone 'Asia/Taipei','MM/DD HH24:MI') || ' 前', ''), '/');
  end if;
  return tid;
end $$;

-- 大人完成自己的交辦（不需核准、沒有點數）
create or replace function public.complete_own_errand(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks;
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and assignee = me.id and kind = 'errand' and status = 'todo';
  if t.id is null then raise exception '找不到這個交辦'; end if;
  update public.tasks set status = 'approved', submitted_at = now(), decided_at = now(), decided_by = me.id where id = p_task;
  if t.created_by is not null and t.created_by <> me.id then
    perform private.notify(t.created_by, '交辦完成', me.display_name || '完成了「' || t.title || '」', '/?tab=errands');
  end if;
end $$;

-- 家長核准或退回任務
create or replace function public.decide_task(p_task uuid, p_approve boolean, p_points int default null, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks; pts int; bonus int := 0; label text;
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and family_id = me.family_id for update;
  if t.id is null or t.status <> 'submitted' then raise exception '這個任務已經處理過了'; end if;
  if not p_approve then
    update public.tasks set status = 'rejected', reject_reason = coalesce(nullif(trim(p_reason),''),'再試一次'), decided_by = me.id, decided_at = now() where id = t.id;
    perform private.notify(t.assignee, '任務被退回', '「' || t.title || '」：' || coalesce(nullif(trim(p_reason),''),'再試一次'), '/');
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
       select 1 from public.tasks where assignee = t.assignee and for_date = t.for_date and pack = t.pack and kind = 'routine' and status <> 'approved')
     and coalesce((select sum(l.amount) from public.ledger l join public.tasks x on x.id = l.ref_id
        where l.member_id = t.assignee and l.ref_type in ('pack','undo') and l.reason like '%全勤獎' and x.for_date = t.for_date and x.pack = t.pack), 0) <= 0 then
    bonus := coalesce(private.setting(t.family_id,'pack_bonus'),10)::int;
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
    values (t.family_id, t.assignee, 'spend', bonus, '全勤獎', 'pack', t.id, me.id);
  end if;
  perform private.notify(t.assignee, '任務核准 +' || (pts + bonus), me.display_name || '核准了「' || t.title || '」' || case when bonus > 0 then '，全勤再加 ' || bonus else '' end, '/');
  return pts + bonus;
end $$;

-- 核准後 10 分鐘內可以復原（帳本用沖銷，不刪紀錄）
create or replace function public.undo_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; t public.tasks;
begin
  me := private.require_parent();
  select * into t from public.tasks where id = p_task and family_id = me.family_id for update;
  if t.id is null or t.status not in ('approved','rejected') or t.decided_at < now() - interval '10 minutes' then raise exception '已經超過可以復原的時間'; end if;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
  select family_id, member_id, account, -sum(amount), '復原：' || case when bool_or(ref_type = 'pack') then '全勤獎' else min(reason) end, 'undo', ref_id, me.id
    from public.ledger where ref_id = t.id and ref_type in ('task','pack','undo')
   group by family_id, member_id, account, ref_id, (ref_type = 'pack' or reason like '%全勤獎') having sum(amount) <> 0;
  update public.tasks set status = 'submitted', decided_by = null, decided_at = null, reject_reason = null where id = t.id;
end $$;

-- 家長激勵點
create or replace function public.give_bonus(p_member uuid, p_amount int, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; kid public.members;
begin
  me := private.require_parent();
  select * into kid from public.members where id = p_member and family_id = me.family_id and role = 'child';
  if kid.id is null then raise exception '只能給孩子點數'; end if;
  if p_amount < 1 or p_amount > 500 then raise exception '一次 1 到 500 點'; end if;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, created_by)
  values (me.family_id, kid.id, 'spend', p_amount, '激勵：' || coalesce(nullif(trim(p_reason),''),'表現很好'), 'bonus', me.id);
  perform private.notify(kid.id, me.display_name || '給你 +' || p_amount || ' 點', coalesce(nullif(trim(p_reason),''),'表現很好') || ' 👍', '/');
end $$;

-- 存入存錢罐
create or replace function public.deposit_jar(p_amount int) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; bonus int;
begin
  me := private.require_child();
  perform 1 from public.members where id = me.id for update;
  if p_amount < 1 or p_amount > private.spend_balance(me.id) then raise exception '零用包的點數不夠'; end if;
  bonus := round(p_amount * coalesce(private.setting(me.family_id,'deposit_bonus'),0.05));
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, created_by)
  values (me.family_id, me.id, 'spend', -p_amount, '存入存錢罐', 'deposit', me.id),
         (me.family_id, me.id, 'jar', p_amount, '從零用包存入', 'deposit', me.id);
  if bonus > 0 then
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, created_by)
    values (me.family_id, me.id, 'jar', bonus, '存入獎勵', 'deposit_bonus', me.id);
  end if;
  insert into public.jar_lots(family_id, member_id, amount) values (me.family_id, me.id, p_amount + bonus);
  return bonus;
end $$;

-- 提前領出（倍率歸零）
create or replace function public.withdraw_jar() returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; raw int;
begin
  me := private.require_child();
  perform 1 from public.members where id = me.id for update;
  select coalesce(sum(amount),0) into raw from public.jar_lots where member_id = me.id;
  if raw = 0 then raise exception '存錢罐是空的'; end if;
  delete from public.jar_lots where member_id = me.id;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, created_by)
  values (me.family_id, me.id, 'jar', -raw, '提前領出', 'withdraw', me.id),
         (me.family_id, me.id, 'spend', raw, '從存錢罐領出', 'withdraw', me.id);
  return raw;
end $$;

-- 從存錢罐扣除（舊的先用，依倍率計價）
create or replace function private.take_from_jar(p_member uuid, p_value int) returns void
language plpgsql security definer set search_path = '' as $$
declare l record; need numeric := p_value; v numeric;
begin
  for l in select id, amount, public.jar_mult(extract(day from now()-deposited_at)::int) as mult from public.jar_lots where member_id = p_member order by deposited_at for update loop
    exit when need <= 0;
    v := l.amount * l.mult;
    if v <= need then need := need - v; delete from public.jar_lots where id = l.id;
    else update public.jar_lots set amount = greatest(1, round((v - need) / l.mult)) where id = l.id; need := 0;
    end if;
  end loop;
  if need > 0.5 then raise exception '存錢罐的點數不夠'; end if;
end $$;

-- 申請兌換（點數先凍結）
create or replace function public.request_redemption(p_reward uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; r public.rewards; src text; w json; rid uuid;
begin
  me := private.require_child();
  perform 1 from public.members where id = me.id for update;
  select * into r from public.rewards where id = p_reward and family_id = me.family_id and active;
  if r.id is null then raise exception '找不到這個獎勵'; end if;
  w := public.get_wallet(me.id);
  src := case when r.tier = 'large' then 'jar'
              when r.tier = 'medium' and (w->>'spend')::int < r.cost then 'jar'
              else 'spend' end;
  if src = 'spend' then
    if (w->>'spend')::int < r.cost then raise exception '零用包還差 % 點', r.cost - (w->>'spend')::int; end if;
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, created_by)
    values (me.family_id, me.id, 'spend', -r.cost, '兌換：' || r.title, 'redeem', me.id);
  else
    if (w->>'jar_value')::int < r.cost then raise exception '存錢罐還差 % 點', r.cost - (w->>'jar_value')::int; end if;
    perform private.take_from_jar(me.id, r.cost);
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, created_by)
    values (me.family_id, me.id, 'jar', -r.cost, '兌換：' || r.title, 'redeem', me.id);
  end if;
  insert into public.redemptions(family_id, member_id, reward_id, title, emoji, cost, source)
  values (me.family_id, me.id, r.id, r.title, r.emoji, r.cost, src) returning id into rid;
  perform private.notify_parents(me.family_id, '兌換申請', me.display_name || '想兌換「' || r.title || '」（' || r.cost || ' 點）', '/?tab=queue');
  return rid;
end $$;

create or replace function public.decide_redemption(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; d public.redemptions;
begin
  me := private.require_parent();
  select * into d from public.redemptions where id = p_id and family_id = me.family_id for update;
  if d.id is null or d.status <> 'pending' then raise exception '這筆兌換已經處理過了'; end if;
  if p_approve then
    update public.redemptions set status = 'approved', decided_by = me.id, decided_at = now() where id = d.id;
    perform private.notify(d.member_id, '兌換成功 🎁', me.display_name || '同意了「' || d.title || '」', '/?tab=shop');
  else
    update public.redemptions set status = 'rejected', reject_reason = p_reason, decided_by = me.id, decided_at = now() where id = d.id;
    insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
    values (d.family_id, d.member_id, d.source, d.cost, '兌換未通過，退回：' || d.title, 'refund', d.id, me.id);
    if d.source = 'jar' then insert into public.jar_lots(family_id, member_id, amount) values (d.family_id, d.member_id, d.cost); end if;
    perform private.notify(d.member_id, '兌換沒有通過', '「' || d.title || '」' || coalesce('：' || nullif(trim(p_reason),''), '') || '，點數已退回', '/?tab=shop');
  end if;
end $$;

-- 夢想目標
create or replace function public.set_dream(p_reward uuid) returns void
language sql security definer set search_path = '' as
$$ update public.members m set dream_reward_id = p_reward where m.id = (select auth.uid())
     and (p_reward is null or exists (select 1 from public.rewards r where r.id = p_reward and r.family_id = m.family_id)) $$;

-- 管理：任務範本、獎勵、設定（家長）
create or replace function public.save_template(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; tid uuid := nullif(p->>'id','')::uuid;
begin
  me := private.require_parent();
  if not exists (select 1 from public.members where id = (p->>'assignee')::uuid and family_id = me.family_id) then raise exception '找不到這位成員'; end if;
  if length(trim(coalesce(p->>'title',''))) = 0 then raise exception '請填任務名稱'; end if;
  if tid is null then
    insert into public.task_templates(family_id, assignee, title, emoji, points, pack, days, photo, active, sort)
    values (me.family_id, (p->>'assignee')::uuid, trim(p->>'title'), coalesce(p->>'emoji','✅'), (p->>'points')::int, nullif(p->>'pack',''),
            coalesce((select array_agg(x::int) from jsonb_array_elements_text(p->'days') x), '{0,1,2,3,4,5,6}'), coalesce(p->>'photo','none'), coalesce((p->>'active')::boolean,true), 99)
    returning id into tid;
  else
    update public.task_templates set assignee = (p->>'assignee')::uuid, title = trim(p->>'title'), emoji = coalesce(p->>'emoji','✅'), points = (p->>'points')::int,
      pack = nullif(p->>'pack',''), days = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p->'days') x), days),
      photo = coalesce(p->>'photo','none'), active = coalesce((p->>'active')::boolean,true)
    where id = tid and family_id = me.family_id;
    update public.tasks set title = trim(p->>'title'), emoji = coalesce(p->>'emoji','✅'), points = (p->>'points')::int, photo = coalesce(p->>'photo','none'), pack = nullif(p->>'pack','')
     where template_id = tid and status = 'todo' and for_date = private.today();
  end if;
  perform private.generate_routines(me.family_id, private.today());
  return tid;
end $$;

create or replace function public.save_reward(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; rid uuid := nullif(p->>'id','')::uuid;
begin
  me := private.require_parent();
  if length(trim(coalesce(p->>'title',''))) = 0 then raise exception '請填獎勵名稱'; end if;
  if rid is null then
    insert into public.rewards(family_id, title, emoji, cost, tier) values (me.family_id, trim(p->>'title'), coalesce(p->>'emoji','🎁'), (p->>'cost')::int, p->>'tier') returning id into rid;
  else
    update public.rewards set title = trim(p->>'title'), emoji = coalesce(p->>'emoji','🎁'), cost = (p->>'cost')::int, tier = p->>'tier', active = coalesce((p->>'active')::boolean,true)
     where id = rid and family_id = me.family_id;
  end if;
  return rid;
end $$;

create or replace function public.save_settings(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.me();
  if me.role <> 'admin' then raise exception '只有管理員可以改規則'; end if;
  update public.families set settings = settings || p where id = me.family_id;
end $$;

create or replace function public.update_profile(p_name text, p_avatar text) returns void
language sql security definer set search_path = '' as
$$ update public.members set display_name = coalesce(nullif(trim(p_name),''), display_name), avatar = coalesce(nullif(p_avatar,''), avatar) where id = (select auth.uid()) $$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = '' as
$$ update public.notifications set read_at = now() where member_id = (select auth.uid()) and read_at is null $$;

-- 排程：每週利息、交辦提醒
create or replace function private.weekly_interest() returns void
language plpgsql security definer set search_path = '' as $$
declare m record; amt int;
begin
  for m in select l.member_id, l.family_id, sum(l.amount) raw from public.jar_lots l group by 1,2 loop
    amt := least(coalesce(private.setting(m.family_id,'interest_cap'),30)::int, round(m.raw * coalesce(private.setting(m.family_id,'interest_rate'),0.02))::int);
    if amt > 0 then
      insert into public.jar_lots(family_id, member_id, amount) values (m.family_id, m.member_id, amt);
      insert into public.ledger(family_id, member_id, account, amount, reason, ref_type) values (m.family_id, m.member_id, 'jar', amt, '存錢罐每週利息', 'interest');
      perform private.notify(m.member_id, '存錢罐長大了 🪙', '這週利息 +' || amt || ' 點，繼續存倍率會更高', '/?tab=jar');
    end if;
  end loop;
end $$;

create or replace function private.errand_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  for t in select * from public.tasks where kind = 'errand' and status = 'todo' and reminded_at is null and due_at between now() and now() + interval '1 hour' loop
    perform private.notify(t.assignee, '交辦快到期', '「' || t.title || '」' || to_char(t.due_at at time zone 'Asia/Taipei','HH24:MI') || ' 前要完成', '/');
    update public.tasks set reminded_at = now() where id = t.id;
  end loop;
end $$;

-- 預設內容：第一個孩子加入時建立
create or replace function private.seed_family(p_family uuid, p_child uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.task_templates where family_id = p_family) then
    insert into public.task_templates(family_id, assignee, title, emoji, points, pack, sort) values
      (p_family, p_child, '刷牙洗臉', '🪥', 5, 'am', 1), (p_family, p_child, '摺好棉被', '🛏️', 5, 'am', 2), (p_family, p_child, '檢查書包', '🎒', 5, 'am', 3),
      (p_family, p_child, '寫完功課', '📚', 10, 'pm', 1), (p_family, p_child, '收衣服', '👕', 8, 'pm', 2),
      (p_family, p_child, '整理房間', '🧸', 5, 'bed', 1), (p_family, p_child, '閱讀 15 分鐘', '📖', 8, 'bed', 2);
  end if;
  if not exists (select 1 from public.rewards where family_id = p_family) then
    insert into public.rewards(family_id, title, emoji, cost, tier) values
      (p_family, '多 30 分鐘平板', '📱', 60, 'small'), (p_family, '挑一支冰淇淋', '🍦', 80, 'small'), (p_family, '週末晚睡 30 分鐘', '🌙', 120, 'small'),
      (p_family, '挑一本書', '📕', 350, 'medium'), (p_family, '決定一餐外食', '🍕', 400, 'medium'),
      (p_family, '樂高一盒', '🧱', 1500, 'large'), (p_family, '遊樂園一日', '🎢', 2000, 'large');
  end if;
  perform private.generate_routines(p_family, private.today());
end $$;

create or replace function public.seed_family_service(p_family uuid, p_child uuid) returns void
language sql security definer set search_path = '' as $$ select private.seed_family(p_family, p_child) $$;

-- 只開放 public 的 RPC 給已登入者
revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on function public.get_wallet, public.ensure_today, public.submit_tasks, public.propose_task, public.create_errand,
  public.complete_own_errand, public.decide_task, public.undo_task, public.give_bonus, public.deposit_jar, public.withdraw_jar,
  public.request_redemption, public.decide_redemption, public.set_dream, public.save_template, public.save_reward,
  public.save_settings, public.update_profile, public.mark_notifications_read, public.jar_mult to authenticated;
revoke execute on all functions in schema private from anon, public;
grant execute on function private.my_family, private.my_role, private.is_parent to authenticated;
grant execute on function public.seed_family_service to service_role;
