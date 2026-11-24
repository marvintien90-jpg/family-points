-- 家庭點點樂 v1.6：LINE 綁定用函式（只給 webhook 的 service role）與權限整理
-- 需要在 Supabase SQL Editor 執行（含 revoke，MCP 需要人工確認）
create or replace function public.line_bind(p_code text, p_group text) returns text
language plpgsql security definer set search_path = '' as $$
declare fid uuid; nm text;
begin
  update private.line_links set group_id = p_group, bound_at = now(), code = null, code_exp = null
   where code = p_code and code_exp > now() returning family_id into fid;
  if fid is null then return null; end if;
  select name into nm from public.families where id = fid;
  return coalesce(nm, '家庭點點樂');
end $$;

create or replace function public.fp_line_config() returns json
language sql stable security definer set search_path = '' as
$$ select json_build_object('token', private.vault_get('fp_line_token'), 'secret', private.vault_get('fp_line_secret')) $$;

revoke execute on function public.line_bind(text, text), public.fp_line_config() from anon, authenticated, public;
grant execute on function public.line_bind(text, text), public.fp_line_config() to service_role;
drop function if exists public.create_errand(text, text, uuid, timestamptz, int);
revoke execute on function public.line_status(), public.line_save_keys(text, text), public.line_new_code(), public.line_unbind(), public.line_test(),
  public.get_streak(uuid), public.deduct_status(uuid), public.deduct_points(uuid, int, text), public.set_goal(text, text, int, uuid),
  public.create_errand(text, text, uuid, timestamptz, int, text), public.attach_photo(uuid, text), public.get_week_report(uuid, date) from anon, public;
grant execute on function public.line_status(), public.line_save_keys(text, text), public.line_new_code(), public.line_unbind(), public.line_test(),
  public.get_streak(uuid), public.deduct_status(uuid), public.deduct_points(uuid, int, text), public.set_goal(text, text, int, uuid),
  public.create_errand(text, text, uuid, timestamptz, int, text), public.attach_photo(uuid, text), public.get_week_report(uuid, date) to authenticated;
