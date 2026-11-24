-- 家庭點點樂 v1.6：連續達成、存錢目標、照片佐證、扣點快選與每日上限、每週報告、LINE 群組通知

-- 預設值（管理員可以在設定改）
update public.families set settings = jsonb_build_object(
    'streak7_bonus', 30, 'streak30_bonus', 150, 'interest_on', 1,
    'deduct_daily_cap', 50, 'deduct_reasons', '沒收拾房間、說話沒禮貌、拖拉超過時間、忘記寫功課、吵架動手',
    'report_on', 1, 'line_on', 1) || settings;
alter table public.families alter column settings set default '{
    "deposit_bonus":0.05, "interest_rate":0.02, "interest_cap":30, "interest_on":1,
    "proposal_bonus":0.2, "proposal_daily_limit":3, "pack_bonus":10,
    "weekly_budget":500, "dual_approval_threshold":500,
    "quiet_start":"21:30", "quiet_end":"07:00", "level_points":300,
    "streak7_bonus":30, "streak30_bonus":150, "deduct_daily_cap":50,
    "deduct_reasons":"沒收拾房間、說話沒禮貌、拖拉超過時間、忘記寫功課、吵架動手",
    "report_on":1, "line_on":1
  }'::jsonb;

-- 孩子自訂的存錢目標 {title, emoji, amount}
alter table public.members add column if not exists goal jsonb;

-- ---------- LINE 群組 ----------
create table if not exists private.line_links (
  family_id uuid primary key references public.families(id) on delete cascade,
  group_id text,
  code text,
  code_exp timestamptz,
  bound_at timestamptz
);
alter table private.line_links enable row level security; -- 只經由 security definer 函式存取

create or replace function private.vault_put(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = p_name;
  if sid is null then perform vault.create_secret(p_value, p_name, '家庭點點樂 LINE');
  else perform vault.update_secret(sid, p_value, p_name, '家庭點點樂 LINE'); end if;
end $$;

create or replace function private.vault_get(p_name text) returns text
language sql stable security definer set search_path = '' as
$$ select decrypted_secret from vault.decrypted_secrets where name = p_name $$;

-- 推送一則文字到家庭 LINE 群組（沒設定或關閉就略過）
create or replace function private.line_send(p_family uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare g text; tok text;
begin
  if coalesce(private.setting(p_family,'line_on'),1) = 0 then return; end if;
  select group_id into g from private.line_links where family_id = p_family;
  tok := private.vault_get('fp_line_token');
  if g is null or tok is null then return; end if;
  perform net.http_post(url := 'https://api.line.me/v2/bot/message/push',
    body := jsonb_build_object('to', g, 'messages', jsonb_build_array(jsonb_build_object('type','text','text', left(p_text, 4900)))),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || tok), timeout_milliseconds := 8000);
end $$;

create or replace function public.line_status() returns json
language plpgsql stable security definer set search_path = '' as $$
declare me public.members; k private.line_links;
begin
  me := private.require_admin();
  select * into k from private.line_links where family_id = me.family_id;
  return json_build_object('has_keys', private.vault_get('fp_line_token') is not null and private.vault_get('fp_line_secret') is not null,
    'bound', k.group_id is not null, 'bound_at', k.bound_at,
    'code', case when k.code_exp > now() then k.code end, 'code_exp', k.code_exp);
end $$;

create or replace function public.line_save_keys(p_token text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.require_admin();
  if length(trim(coalesce(p_token,''))) < 20 then raise exception 'Channel access token 看起來不完整'; end if;
  if length(trim(coalesce(p_secret,''))) < 10 then raise exception 'Channel secret 看起來不完整'; end if;
  perform private.vault_put('fp_line_token', trim(p_token));
  perform private.vault_put('fp_line_secret', trim(p_secret));
end $$;

create or replace function public.line_new_code() returns text
language plpgsql security definer set search_path = '' as $$
declare me public.members; c text := lpad((floor(random() * 1000000))::int::text, 6, '0');
begin
  me := private.require_admin();
  insert into private.line_links(family_id, code, code_exp) values (me.family_id, c, now() + interval '30 minutes')
  on conflict (family_id) do update set code = excluded.code, code_exp = excluded.code_exp;
  return c;
end $$;

create or replace function public.line_unbind() returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.require_admin();
  update private.line_links set group_id = null, bound_at = null where family_id = me.family_id;
end $$;

create or replace function public.line_test() returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.require_admin();
  if not exists (select 1 from private.line_links where family_id = me.family_id and group_id is not null) then raise exception '還沒綁定 LINE 群組'; end if;
  perform private.line_send(me.family_id, '🔔 家庭點點樂測試訊息：' || me.display_name || '在設定按了「傳送測試」。');
end $$;

-- 只給 LINE webhook（service role）用：綁定碼換群組


-- 兌換申請、孩子送出交辦 → 群組
create or replace function private.line_on_redemption() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  select display_name into nm from public.members where id = new.member_id;
  perform private.line_send(new.family_id, '🎁 ' || nm || '想兌換「' || new.title || '」（' || new.cost || ' 點），請到 App 待辦處理。');
  return new;
end $$;
create trigger fp_line_redemption after insert on public.redemptions for each row execute function private.line_on_redemption();

create or replace function private.line_on_errand_done() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nm text; rl text;
begin
  select display_name, role into nm, rl from public.members where id = new.assignee;
  if rl = 'child' then
    perform private.line_send(new.family_id, '📌 ' || nm || '完成交辦「' || new.title || '」' || case when new.photo_path is not null then '（附照片）' else '' end || '，等你核准。');
  end if;
  return new;
end $$;
create trigger fp_line_errand after update of status on public.tasks for each row
  when (new.kind = 'errand' and new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function private.line_on_errand_done();

-- ---------- 連續達成 ----------
-- 某天的例行：-1 沒有例行、1 全部核准、0 還沒全部完成
create or replace function private.day_done(p_member uuid, p_day date) returns int
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 0 then -1 when bool_and(status = 'approved') then 1 else 0 end
    from public.tasks where assignee = p_member and kind = 'routine' and for_date = p_day and status <> 'void'
$$;

-- 到某天為止連續幾天全部完成（沒有例行的日子跳過）
create or replace function private.streak_at(p_member uuid, p_day date) returns int
language plpgsql stable security definer set search_path = '' as $$
declare n int := 0; i int := 0; s int; d date := p_day; first date;
begin
  select min(for_date) into first from public.tasks where assignee = p_member and kind = 'routine';
  if first is null then return 0; end if;
  while d >= first and i < 400 loop
    s := private.day_done(p_member, d);
    if s = 0 then exit; end if;
    if s = 1 then n := n + 1; end if;
    d := d - 1; i := i + 1;
  end loop;
  return n;
end $$;

-- 核准例行後檢查：連續 7 天、30 天給獎勵（同一天只給一次）
create or replace function private.check_streak(p_task uuid, p_by uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; n int; amt int := 0; label text; nm text;
begin
  select * into t from public.tasks where id = p_task;
  if t.kind <> 'routine' or t.for_date is null or private.day_done(t.assignee, t.for_date) <> 1 then return 0; end if;
  if coalesce((select sum(l.amount) from public.ledger l join public.tasks x on x.id = l.ref_id
       where l.member_id = t.assignee and l.ref_type = 'streak' and x.for_date = t.for_date), 0) > 0 then return 0; end if;
  n := private.streak_at(t.assignee, t.for_date);
  if n > 0 and n % 30 = 0 then amt := coalesce(private.setting(t.family_id,'streak30_bonus'),150)::int; label := '連續 ' || n || ' 天全部完成 🏆';
  elsif n > 0 and n % 7 = 0 then amt := coalesce(private.setting(t.family_id,'streak7_bonus'),30)::int; label := '連續 ' || n || ' 天全部完成 🔥';
  end if;
  if amt <= 0 then return 0; end if;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
  values (t.family_id, t.assignee, 'spend', amt, label, 'streak', t.id, p_by);
  select display_name into nm from public.members where id = t.assignee;
  perform private.notify(t.assignee, '連續達成 +' || amt, '你已經' || label || '，太厲害了！', '/?tab=me');
  perform private.notify_parents(t.family_id, nm || label, '自動加 ' || amt || ' 點', '/?tab=history');
  perform private.line_send(t.family_id, '🔥 ' || nm || label || '，自動加 ' || amt || ' 點！');
  return amt;
end $$;

-- 撤銷例行核准時，收回受影響的連續獎勵
create or replace function private.on_routine_unapprove() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, created_by)
  select l.family_id, l.member_id, 'spend', -sum(l.amount), '撤銷：連續達成獎勵', 'streak', l.ref_id, (select auth.uid())
    from public.ledger l join public.tasks x on x.id = l.ref_id
   where l.member_id = new.assignee and l.ref_type = 'streak' and x.for_date between new.for_date and new.for_date + 30
   group by l.family_id, l.member_id, l.ref_id having sum(l.amount) > 0;
  return new;
end $$;
create trigger fp_routine_unapprove after update of status on public.tasks for each row
  when (new.kind = 'routine' and old.status = 'approved' and new.status <> 'approved')
  execute function private.on_routine_unapprove();

create or replace function public.get_streak(p_member uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare me public.members; target uuid; cur int; td int;
begin
  me := private.me();
  target := coalesce(p_member, me.id);
  if not exists (select 1 from public.members where id = target and family_id = me.family_id) then raise exception '找不到這位成員'; end if;
  if me.role not in ('admin','parent') and target <> me.id then raise exception '只能看自己的'; end if;
  td := private.day_done(target, private.today());
  cur := private.streak_at(target, case when td = 1 then private.today() else private.today() - 1 end);
  return json_build_object('current', cur, 'today_done', td = 1,
    'b7', (select count(*) from (select l.ref_id from public.ledger l where l.member_id = target and l.ref_type = 'streak' and l.reason like '%🔥' group by l.ref_id having sum(l.amount) > 0) a),
    'b30', (select count(*) from (select l.ref_id from public.ledger l where l.member_id = target and l.ref_type = 'streak' and l.reason like '%🏆' group by l.ref_id having sum(l.amount) > 0) b));
end $$;

-- 核准＋評價＋連續達成檢查
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
  if t.kind = 'routine' then r := r + private.check_streak(p_task, me.id); end if;
  return r;
end $$;

-- ---------- 扣點（快選原因、每日上限） ----------
create or replace function private.deducted_today(p_member uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(-sum(l.amount),0)::int from public.ledger l
   where l.member_id = p_member and (l.created_at at time zone 'Asia/Taipei')::date = private.today()
     and (l.ref_type = 'deduct' or (l.ref_type = 'adjust' and l.ref_ledger in (select id from public.ledger where member_id = p_member and ref_type = 'deduct')))
$$;

create or replace function public.deduct_status(p_member uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.require_parent();
  if not exists (select 1 from public.members where id = p_member and family_id = me.family_id and role = 'child') then raise exception '只能扣孩子的點數'; end if;
  return json_build_object('used', private.deducted_today(p_member), 'cap', coalesce(private.setting(me.family_id,'deduct_daily_cap'),50)::int,
    'reasons', (select settings->>'deduct_reasons' from public.families where id = me.family_id));
end $$;

create or replace function public.deduct_points(p_member uuid, p_amount int, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; kid public.members; cap int; used int; why text := nullif(trim(coalesce(p_reason,'')),'');
begin
  me := private.require_parent();
  select * into kid from public.members where id = p_member and family_id = me.family_id and role = 'child' for update;
  if kid.id is null then raise exception '只能扣孩子的點數'; end if;
  if why is null then raise exception '請選扣點原因'; end if;
  if length(why) > 30 then raise exception '原因太長了'; end if;
  if p_amount is null or p_amount < 1 then raise exception '請選要扣幾點'; end if;
  cap := coalesce(private.setting(me.family_id,'deduct_daily_cap'),50)::int;
  used := private.deducted_today(kid.id);
  if used + p_amount > cap then
    raise exception '今天最多扣 % 點，已經扣了 % 點，還能扣 % 點', cap, used, greatest(cap - used, 0);
  end if;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, created_by)
  values (me.family_id, kid.id, 'spend', -p_amount, '扣點：' || why, 'deduct', me.id);
  perform private.notify(kid.id, '被扣 ' || p_amount || ' 點', me.display_name || '：' || why || '。下次加油，好好表現可以再賺回來。', '/?tab=history');
  insert into public.notifications(family_id, member_id, title, body, url)
  select family_id, id, '扣點紀錄', me.display_name || '扣了' || kid.display_name || ' ' || p_amount || ' 點：' || why, '/?tab=history'
    from public.members where family_id = me.family_id and role in ('admin','parent') and id <> me.id;
  perform private.line_send(me.family_id, '⚠️ ' || me.display_name || '扣了' || kid.display_name || ' ' || p_amount || ' 點：' || why || '（今天共扣 ' || (used + p_amount) || ' / ' || cap || '）');
  return used + p_amount;
end $$;

-- 管理員修正：扣點可以退回（刪除或減少扣的點數）
create or replace function public.admin_edit_ledger(p_id bigint, p_amount int, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.members; l public.ledger; cur int; delta int; label text;
begin
  me := private.require_admin();
  select * into l from public.ledger where id = p_id and family_id = me.family_id;
  if l.id is null then raise exception '找不到這筆紀錄'; end if;
  if l.ref_ledger is not null then raise exception '這是修正紀錄，請改原本那筆'; end if;
  if l.account <> 'spend' or l.ref_type not in ('task','pack','bonus','deduct') then raise exception '這種紀錄不能修改（兌換、存錢罐請用原本的流程處理）'; end if;
  if l.ref_type = 'deduct' then
    if p_amount is null or p_amount > 0 or p_amount < l.amount then raise exception '扣點只能減少或退回'; end if;
  elsif p_amount is null or p_amount < 0 or p_amount > 5000 then raise exception '點數要在 0 到 5000 之間'; end if;
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
  label := case when p_amount = 0 then case when l.ref_type = 'deduct' then '退回：' else '刪除：' end else '修改：' end || l.reason;
  insert into public.ledger(family_id, member_id, account, amount, reason, ref_type, ref_id, ref_ledger, created_by)
  values (l.family_id, l.member_id, 'spend', delta, label, 'adjust', l.ref_id, l.id, me.id);
  perform private.notify(l.member_id, case when l.ref_type = 'deduct' and p_amount = 0 then '扣的點數退回了' when p_amount = 0 then '一筆點數被刪除' else '點數已修正' end,
    '「' || l.reason || '」' || cur || ' → ' || p_amount || ' 點' || coalesce('：' || nullif(trim(p_reason),''), ''), '/?tab=history');
  return p_amount;
end $$;

-- 等級：連續獎勵算進累積，扣點不影響等級
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
   where member_id = target.id and ref_type in ('task','pack','bonus','interest','deposit_bonus','undo','streak')
      or (member_id = target.id and ref_type = 'adjust' and ref_ledger not in (select id from public.ledger where member_id = target.id and ref_type = 'deduct'));
  select json_build_object(
    'member_id', target.id,
    'spend', private.spend_balance(target.id),
    'jar_raw', coalesce((select sum(amount) from public.jar_lots where member_id = target.id),0),
    'jar_value', coalesce((select round(sum(amount * public.jar_mult(extract(day from now()-deposited_at)::int))) from public.jar_lots where member_id = target.id),0),
    'best_days', coalesce((select max(extract(day from now()-deposited_at)::int) from public.jar_lots where member_id = target.id),0),
    'lifetime', greatest(life,0), 'level', greatest(life,0) / lvp + 1, 'level_points', lvp,
    'interest_on', coalesce(private.setting(target.family_id,'interest_on'),1) <> 0,
    'next_interest', case when coalesce(private.setting(target.family_id,'interest_on'),1) = 0 then 0 else
       least(coalesce(private.setting(target.family_id,'interest_cap'),30)::int, round(coalesce((select sum(amount) from public.jar_lots where member_id = target.id),0) * coalesce(private.setting(target.family_id,'interest_rate'),0.02))::int) end,
    'lots', coalesce((select json_agg(json_build_object('id',id,'amount',amount,'days',extract(day from now()-deposited_at)::int) order by deposited_at) from public.jar_lots where member_id = target.id),'[]'::json)
  ) into r;
  return r;
end $$;

-- ---------- 存錢目標、利息開關 ----------
create or replace function public.set_goal(p_title text, p_emoji text, p_amount int, p_member uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members; target uuid;
begin
  me := private.me();
  target := coalesce(p_member, me.id);
  if not exists (select 1 from public.members where id = target and family_id = me.family_id and role = 'child') then raise exception '找不到這位孩子'; end if;
  if me.role not in ('admin','parent') and target <> me.id then raise exception '只能設定自己的目標'; end if;
  if p_title is null or length(trim(p_title)) = 0 then update public.members set goal = null where id = target; return; end if;
  if length(trim(p_title)) > 30 then raise exception '名稱太長了'; end if;
  if p_amount is null or p_amount < 10 or p_amount > 100000 then raise exception '目標點數要在 10 到 100000 之間'; end if;
  update public.members set goal = jsonb_build_object('title', trim(p_title), 'emoji', coalesce(nullif(p_emoji,''),'🎯'), 'amount', p_amount, 'set_at', now()) where id = target;
  if me.role = 'child' then perform private.notify_parents(me.family_id, '新的存錢目標', me.display_name || '想存 ' || p_amount || ' 點買「' || trim(p_title) || '」', '/?tab=history'); end if;
end $$;

create or replace function private.weekly_interest() returns void
language plpgsql security definer set search_path = '' as $$
declare m record; amt int;
begin
  for m in select l.member_id, l.family_id, sum(l.amount) raw from public.jar_lots l group by 1,2 loop
    if coalesce(private.setting(m.family_id,'interest_on'),1) = 0 then continue; end if;
    amt := least(coalesce(private.setting(m.family_id,'interest_cap'),30)::int, round(m.raw * coalesce(private.setting(m.family_id,'interest_rate'),0.02))::int);
    if amt > 0 then
      insert into public.jar_lots(family_id, member_id, amount) values (m.family_id, m.member_id, amt);
      insert into public.ledger(family_id, member_id, account, amount, reason, ref_type) values (m.family_id, m.member_id, 'jar', amt, '存錢罐每週利息', 'interest');
      perform private.notify(m.member_id, '存錢罐長大了 🪙', '這週利息 +' || amt || ' 點，繼續存倍率會更高', '/?tab=jar');
    end if;
  end loop;
end $$;

-- ---------- 照片佐證 ----------
-- 交辦可以要求照片（none 不需要、optional 可附、required 必須）
-- 舊的 5 參數版本由 0010 移除；前端一律帶 p_photo
create or replace function public.create_errand(p_title text, p_emoji text, p_assignee uuid, p_due timestamptz, p_points int default 0, p_photo text default 'optional') returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.members; tid uuid; who text;
begin
  me := private.require_parent();
  select display_name into who from public.members where id = p_assignee and family_id = me.family_id;
  if who is null then raise exception '找不到這位成員'; end if;
  if length(trim(coalesce(p_title,''))) = 0 then raise exception '請寫交辦內容'; end if;
  if coalesce(p_points,0) not between 0 and 5000 then raise exception '交辦獎勵要在 0 到 5000 點之間'; end if;
  if coalesce(p_photo,'optional') not in ('none','optional','required') then raise exception '照片設定不正確'; end if;
  insert into public.tasks(family_id, kind, title, emoji, points, assignee, created_by, due_at, photo)
  values (me.family_id, 'errand', trim(p_title), coalesce(p_emoji,'📌'), greatest(coalesce(p_points,0),0), p_assignee, me.id, p_due, coalesce(p_photo,'optional')) returning id into tid;
  if p_assignee <> me.id then
    perform private.notify(p_assignee, '新的交辦事項', me.display_name || '交辦：「' || trim(p_title) || '」' ||
      coalesce('，' || to_char(p_due at time zone 'Asia/Taipei','MM/DD HH24:MI') || ' 前', '') || case when p_photo = 'required' then '（完成要拍照）' else '' end, '/');
  end if;
  return tid;
end $$;

-- 孩子在送出後補附照片（主動提案用）
create or replace function public.attach_photo(p_task uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.me();
  if p_path is null or split_part(p_path, '/', 1) <> me.family_id::text then raise exception '照片路徑不正確'; end if;
  update public.tasks set photo_path = p_path where id = p_task and assignee = me.id and status in ('todo','submitted','rejected');
  if not found then raise exception '找不到這個任務'; end if;
end $$;

-- ---------- 每週報告 ----------
create or replace function private.week_report(p_member uuid, p_end date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare s date := p_end - 6; t0 timestamptz; t1 timestamptz; r json; deduct_ids bigint[];
begin
  t0 := (s::timestamp) at time zone 'Asia/Taipei'; t1 := ((p_end + 1)::timestamp) at time zone 'Asia/Taipei';
  select coalesce(array_agg(id), '{}') into deduct_ids from public.ledger where member_id = p_member and ref_type = 'deduct';
  select json_build_object(
    'start', s, 'end', p_end,
    'earned', coalesce((select sum(amount) from public.ledger where member_id = p_member and created_at >= t0 and created_at < t1
        and (ref_type in ('task','pack','bonus','undo','streak') or (ref_type = 'adjust' and not (ref_ledger = any(deduct_ids))))),0),
    'deducted', coalesce((select -sum(amount) from public.ledger where member_id = p_member and created_at >= t0 and created_at < t1
        and (ref_type = 'deduct' or (ref_type = 'adjust' and ref_ledger = any(deduct_ids)))),0),
    'spent', coalesce((select -sum(amount) from public.ledger where member_id = p_member and created_at >= t0 and created_at < t1 and ref_type in ('redeem','refund')),0),
    'saved', coalesce((select sum(amount) from public.ledger where member_id = p_member and created_at >= t0 and created_at < t1 and ref_type = 'deposit' and account = 'jar'),0),
    'interest', coalesce((select sum(amount) from public.ledger where member_id = p_member and created_at >= t0 and created_at < t1 and ref_type in ('interest','deposit_bonus')),0),
    'routine_total', (select count(*) from public.tasks where assignee = p_member and kind = 'routine' and status <> 'void' and for_date between s and p_end),
    'routine_done', (select count(*) from public.tasks where assignee = p_member and kind = 'routine' and status = 'approved' and for_date between s and p_end),
    'errands_done', (select count(*) from public.tasks where assignee = p_member and kind = 'errand' and status = 'approved' and decided_at >= t0 and decided_at < t1),
    'proposals_done', (select count(*) from public.tasks where assignee = p_member and kind = 'proposal' and status = 'approved' and decided_at >= t0 and decided_at < t1),
    'ratings', coalesce((select json_object_agg(rating, n) from (select rating, count(*) n from public.tasks where assignee = p_member and rating is not null and decided_at >= t0 and decided_at < t1 group by rating) x), '{}'::json),
    'streak', private.streak_at(p_member, case when private.day_done(p_member, p_end) = 1 then p_end else p_end - 1 end),
    'spend_balance', private.spend_balance(p_member),
    'jar', coalesce((select round(sum(amount * public.jar_mult(extract(day from now()-deposited_at)::int))) from public.jar_lots where member_id = p_member),0)
  ) into r;
  return r;
end $$;

create or replace function public.get_week_report(p_member uuid, p_end date default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare me public.members;
begin
  me := private.me();
  if not exists (select 1 from public.members where id = p_member and family_id = me.family_id and role = 'child') then raise exception '找不到這位孩子'; end if;
  if me.role not in ('admin','parent') and p_member <> me.id then raise exception '只能看自己的'; end if;
  return private.week_report(p_member, coalesce(p_end, private.today()));
end $$;

create or replace function private.report_text(p_name text, r json) returns text
language sql stable set search_path = '' as $$
  select '📊 ' || p_name || '本週報告（' || to_char((r->>'start')::date,'MM/DD') || '–' || to_char((r->>'end')::date,'MM/DD') || '）' || chr(10) ||
    '賺 ' || (r->>'earned') || ' 點、兌換 ' || (r->>'spent') || ' 點' || case when (r->>'deducted')::int > 0 then '、扣 ' || (r->>'deducted') || ' 點' else '' end || chr(10) ||
    '例行完成 ' || case when (r->>'routine_total')::int > 0 then round((r->>'routine_done')::numeric * 100 / (r->>'routine_total')::int) || '%（' || (r->>'routine_done') || '/' || (r->>'routine_total') || '）' else '—' end ||
    '、交辦 ' || (r->>'errands_done') || ' 件、主動 ' || (r->>'proposals_done') || ' 件' || chr(10) ||
    coalesce('評價 ' || nullif((select string_agg(k || '×' || v, ' ') from json_each_text(r->'ratings') as e(k, v)), '') || chr(10), '') ||
    '連續全部完成 ' || (r->>'streak') || ' 天 · 零用包 ' || (r->>'spend_balance') || ' · 存錢罐 ' || (r->>'jar')
$$;

create or replace function private.send_week_reports() returns void
language plpgsql security definer set search_path = '' as $$
declare k record; r json; txt text;
begin
  for k in select m.id, m.family_id, m.display_name from public.members m where m.role = 'child' loop
    if coalesce(private.setting(k.family_id,'report_on'),1) = 0 then continue; end if;
    r := private.week_report(k.id, private.today());
    txt := private.report_text(k.display_name, r);
    perform private.notify_parents(k.family_id, split_part(txt, chr(10), 1), substr(txt, position(chr(10) in txt) + 1), '/?tab=history&report=1');
    perform private.line_send(k.family_id, txt);
  end loop;
end $$;

-- 每週日台灣 20:00（UTC 12:00）
select cron.schedule('fp-weekly-report', '0 12 * * 0', $$ select private.send_week_reports() $$);

