-- 家庭點點樂：資料結構
create schema if not exists private;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{
    "deposit_bonus":0.05, "interest_rate":0.02, "interest_cap":30,
    "proposal_bonus":0.2, "proposal_daily_limit":3, "pack_bonus":10,
    "weekly_budget":500, "dual_approval_threshold":500,
    "quiet_start":"21:30", "quiet_end":"07:00", "level_points":300
  }'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.families is '家庭點點樂：家庭與規則設定';

create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','parent','child','guest')),
  avatar text not null default '🙂',
  login_id text not null unique,
  dream_reward_id uuid,
  created_at timestamptz not null default now()
);
create index on public.members(family_id);
comment on table public.members is '家庭點點樂：家庭成員與身份（admin 管理員家長、parent 家長、child 孩子、guest 訪客）';

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  assignee uuid not null references public.members(id) on delete cascade,
  title text not null,
  emoji text not null default '✅',
  points int not null check (points between 0 and 1000),
  pack text check (pack in ('am','pm','bed')),
  days int[] not null default '{0,1,2,3,4,5,6}',
  photo text not null default 'none' check (photo in ('none','optional','required')),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.task_templates(family_id);
create index on public.task_templates(assignee);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  template_id uuid references public.task_templates(id) on delete set null,
  kind text not null check (kind in ('routine','proposal','errand')),
  title text not null,
  emoji text not null default '✅',
  points int not null default 0 check (points between 0 and 1000),
  pack text check (pack in ('am','pm','bed')),
  photo text not null default 'none',
  assignee uuid not null references public.members(id) on delete cascade,
  created_by uuid references public.members(id) on delete set null,
  for_date date,
  due_at timestamptz,
  status text not null default 'todo' check (status in ('todo','submitted','approved','rejected')),
  photo_path text,
  reject_reason text,
  submitted_at timestamptz,
  decided_by uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_id, for_date)
);
create index on public.tasks(family_id, status);
create index on public.tasks(assignee, for_date);
create index on public.tasks(template_id);
create index on public.tasks(created_by);
create index on public.tasks(decided_by);

create table public.ledger (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  account text not null check (account in ('spend','jar')),
  amount int not null,
  reason text not null,
  ref_type text,
  ref_id uuid,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.ledger(member_id, created_at desc);
create index on public.ledger(family_id, created_at desc);
create index on public.ledger(created_by);
create index on public.ledger(ref_id);
comment on table public.ledger is '家庭點點樂：點數帳本，只能新增，不能修改或刪除';

create table public.jar_lots (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  amount int not null check (amount > 0),
  deposited_at timestamptz not null default now()
);
create index on public.jar_lots(member_id);
create index on public.jar_lots(family_id);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  emoji text not null default '🎁',
  cost int not null check (cost > 0),
  tier text not null check (tier in ('small','medium','large')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.rewards(family_id);
alter table public.members add constraint members_dream_fk foreign key (dream_reward_id) references public.rewards(id) on delete set null;
create index on public.members(dream_reward_id);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  reward_id uuid references public.rewards(id) on delete set null,
  title text not null,
  emoji text not null,
  cost int not null,
  source text not null check (source in ('spend','jar')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  decided_by uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.redemptions(family_id, status);
create index on public.redemptions(member_id);
create index on public.redemptions(reward_id);
create index on public.redemptions(decided_by);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions(member_id);

create table public.notifications (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  title text not null,
  body text not null,
  url text not null default '/',
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications(member_id, created_at desc);
create index on public.notifications(family_id);
create index on public.notifications(created_at) where sent_at is null;

-- ---------- 權限輔助 ----------
create or replace function private.my_family() returns uuid
language sql stable security definer set search_path = '' as
$$ select family_id from public.members where id = (select auth.uid()) $$;
create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as
$$ select role from public.members where id = (select auth.uid()) $$;
create or replace function private.is_parent() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role in ('admin','parent') from public.members where id = (select auth.uid())), false) $$;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------- RLS：所有寫入都走函式，表格本身只開放讀取 ----------
alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.ledger enable row level security;
alter table public.jar_lots enable row level security;
alter table public.rewards enable row level security;
alter table public.redemptions enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;

create policy fam_read on public.families for select to authenticated using (id = (select private.my_family()));
create policy mem_read on public.members for select to authenticated using (family_id = (select private.my_family()));
create policy tpl_read on public.task_templates for select to authenticated using (family_id = (select private.my_family()) and (select private.my_role()) <> 'guest');
create policy task_read on public.tasks for select to authenticated using (family_id = (select private.my_family()) and ((select private.is_parent()) or assignee = (select auth.uid())));
create policy ledger_read on public.ledger for select to authenticated using (family_id = (select private.my_family()) and ((select private.is_parent()) or member_id = (select auth.uid())));
create policy lots_read on public.jar_lots for select to authenticated using (family_id = (select private.my_family()) and ((select private.is_parent()) or member_id = (select auth.uid())));
create policy rew_read on public.rewards for select to authenticated using (family_id = (select private.my_family()));
create policy red_read on public.redemptions for select to authenticated using (family_id = (select private.my_family()) and ((select private.is_parent()) or member_id = (select auth.uid())));
create policy push_own on public.push_subscriptions for all to authenticated using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));
create policy notif_read on public.notifications for select to authenticated using (member_id = (select auth.uid()));
create policy notif_mark on public.notifications for update to authenticated using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant insert, delete on public.push_subscriptions to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 照片
insert into storage.buckets (id, name, public) values ('task-photos','task-photos', false) on conflict do nothing;
create policy fp_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select private.my_family())::text);
create policy fp_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select private.my_family())::text);
