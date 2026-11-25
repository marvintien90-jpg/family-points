-- 家庭點點樂 v1.7：移除 LINE 串連、孩子也收到每週成績單、權限整理
-- 含 drop／revoke，需在 Supabase SQL Editor 執行

-- 1) 不再呼叫 LINE
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
  return amt;
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
  return used + p_amount;
end $$;

create or replace function private.send_week_reports() returns void
language plpgsql security definer set search_path = '' as $$
declare k record; r json; txt text; pct int;
begin
  for k in select m.id, m.family_id, m.display_name from public.members m where m.role = 'child' loop
    if coalesce(private.setting(k.family_id,'report_on'),1) = 0 then continue; end if;
    r := private.week_report(k.id, private.today());
    txt := private.report_text(k.display_name, r);
    perform private.notify_parents(k.family_id, split_part(txt, chr(10), 1), substr(txt, position(chr(10) in txt) + 1), '/?tab=history&report=1');
    -- 孩子也收到自己的週報（鼓勵的口吻，不提扣點）
    pct := case when (r->>'routine_total')::int > 0 then round((r->>'routine_done')::numeric * 100 / (r->>'routine_total')::int) else null end;
    perform private.notify(k.id, '📊 你這週的成績單',
      '賺了 ' || (r->>'earned') || ' 點' || coalesce('、例行完成 ' || pct || '%', '') ||
      case when (r->>'streak')::int > 0 then '、連續 ' || (r->>'streak') || ' 天全部完成 🔥' else '' end ||
      case when coalesce(pct, 0) >= 80 then '。太棒了，下週繼續保持！' else '。下週一起加油，每天完成例行就能累積連續獎勵！' end,
      '/?tab=history&report=1');
  end loop;
end $$;

-- 1b) 家長待辦頁的孩子總覽：get_streak 多回傳今天例行的進度
create or replace function public.get_streak(p_member uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare me public.members; target uuid; cur int; td int; t_all int; t_ok int; t_sub int;
begin
  me := private.me();
  target := coalesce(p_member, me.id);
  if not exists (select 1 from public.members where id = target and family_id = me.family_id) then raise exception '找不到這位成員'; end if;
  if me.role not in ('admin','parent') and target <> me.id then raise exception '只能看自己的'; end if;
  td := private.day_done(target, private.today());
  cur := private.streak_at(target, case when td = 1 then private.today() else private.today() - 1 end);
  select count(*), count(*) filter (where status = 'approved'), count(*) filter (where status = 'submitted')
    into t_all, t_ok, t_sub
    from public.tasks where assignee = target and kind = 'routine' and for_date = private.today() and status <> 'void';
  return json_build_object('current', cur, 'today_done', td = 1,
    'today_total', t_all, 'today_approved', t_ok, 'today_submitted', t_sub,
    'b7', (select count(*) from (select l.ref_id from public.ledger l where l.member_id = target and l.ref_type = 'streak' and l.reason like '%🔥' group by l.ref_id having sum(l.amount) > 0) a),
    'b30', (select count(*) from (select l.ref_id from public.ledger l where l.member_id = target and l.ref_type = 'streak' and l.reason like '%🏆' group by l.ref_id having sum(l.amount) > 0) b));
end $$;

-- 2) 移除 LINE 相關觸發器、函式、資料表與金鑰
drop trigger if exists fp_line_redemption on public.redemptions;
drop trigger if exists fp_line_errand on public.tasks;
drop function if exists private.line_on_redemption();
drop function if exists private.line_on_errand_done();
drop function if exists public.line_status();
drop function if exists public.line_save_keys(text, text);
drop function if exists public.line_new_code();
drop function if exists public.line_unbind();
drop function if exists public.line_test();
drop function if exists public.line_bind(text, text);
drop function if exists public.fp_line_config();
drop function if exists private.line_send(uuid, text);
drop function if exists private.vault_put(text, text);
drop function if exists private.vault_get(text);
drop table if exists private.line_links;
delete from vault.secrets where name in ('fp_line_token', 'fp_line_secret');
update public.families set settings = settings - 'line_on';

-- 3) 權限整理：舊的 3 參數提案函式不再使用；未登入的人不能呼叫任何函式
drop function if exists public.propose_task(text, text, int);
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
