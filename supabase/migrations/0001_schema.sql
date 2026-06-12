-- =============================================================
-- 排球季打管理系統 v1.2 — Schema
-- 設計原則:事實與規則分離。events / session_subs / payment_events
-- 為只追加事件表,金額永不落地(settlements 結算快照除外)。
-- 時區假設:所有場次時間為 Asia/Taipei。
-- =============================================================

-- 使用者(由 LINE Login 建立;隊員與遞補者共用)
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  line_user_id text unique,
  display_name text,
  avatar_url text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- 季
create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'settled')),
  created_at timestamptz not null default now()
);

-- 季規則(版本化:每次修改新增一列,生效中 = 最新一列)
create table season_rules (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons (id) on delete cascade,
  season_fee int not null check (season_fee >= 0),
  refund_per_session int not null check (refund_per_session >= 0),
  sub_fee_per_session int not null default 225 check (sub_fee_per_session >= 0),
  leave_deadline_hours int not null default 2 check (leave_deadline_hours >= 0),
  refund_requires_sub boolean not null default true,
  effective_from timestamptz not null default now(),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- 場次
create table sessions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons (id) on delete cascade,
  session_date date not null,
  start_time time not null,
  end_time time not null,
  venue text not null default '',
  capacity int not null default 18 check (capacity > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  note text
);

-- 季成員
create table season_members (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons (id) on delete cascade,
  profile_id uuid not null references profiles (id),
  joined_at date not null default current_date,
  status text not null default 'active' check (status in ('active', 'quit')),
  unique (season_id, profile_id)
);

-- 事件(核心表:只追加,不更新不刪除)
create table events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  season_member_id uuid not null references season_members (id) on delete cascade,
  type text not null check (type in ('leave', 'leave_cancel', 'attend_correction')),
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

-- 遞補報名(只追加 + 可撤銷:status 為唯一可變欄位)
create table session_subs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  profile_id uuid not null references profiles (id),
  status text not null default 'signed_up' check (status in ('signed_up', 'withdrawn', 'no_show')),
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  unique (session_id, profile_id)
);

-- 繳費事件(只追加;隊員季費與遞補者單場費共用,二擇一)
create table payment_events (
  id uuid primary key default gen_random_uuid(),
  season_member_id uuid references season_members (id) on delete cascade,
  session_sub_id uuid references session_subs (id) on delete cascade,
  type text not null check (type in ('payment', 'adjustment')),
  amount int not null,
  note text,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(season_member_id, session_sub_id) = 1)
);

-- 結算快照(季結束時一次性寫入,鎖定金額)
create table settlements (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons (id) on delete cascade,
  season_member_id uuid not null references season_members (id),
  refundable_leaves int not null,
  refund_amount int not null,
  balance int not null,
  settled_at timestamptz not null default now(),
  settled_by uuid references profiles (id),
  unique (season_id, season_member_id)
);

-- 索引
create index idx_sessions_season on sessions (season_id, session_date);
create index idx_season_members_season on season_members (season_id);
create index idx_season_members_profile on season_members (profile_id);
create index idx_events_session_member on events (session_id, season_member_id, created_at desc);
create index idx_session_subs_session on session_subs (session_id);
create index idx_session_subs_profile on session_subs (profile_id);
create index idx_payment_events_member on payment_events (season_member_id);
create index idx_payment_events_sub on payment_events (session_sub_id);
create index idx_season_rules_season on season_rules (season_id, effective_from desc);

-- 事件表禁止 UPDATE / DELETE(只追加),用觸發器硬性保證
create or replace function fn_forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% 為只追加事件表,禁止 % 操作', tg_table_name, tg_op;
end $$;

create trigger trg_events_append_only
  before update or delete on events
  for each row execute function fn_forbid_mutation();

create trigger trg_payment_events_append_only
  before update or delete on payment_events
  for each row execute function fn_forbid_mutation();

-- session_subs 僅允許改 status(撤銷/標記 no_show),其餘欄位不可變
create or replace function fn_session_subs_guard() returns trigger
language plpgsql as $$
begin
  if new.id <> old.id or new.session_id <> old.session_id
     or new.profile_id <> old.profile_id or new.created_at <> old.created_at then
    raise exception 'session_subs 僅允許變更 status 欄位';
  end if;
  return new;
end $$;

create trigger trg_session_subs_guard
  before update on session_subs
  for each row execute function fn_session_subs_guard();
