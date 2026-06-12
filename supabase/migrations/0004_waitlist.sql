-- =============================================================
-- v1.3 候補制改版
-- 1. 候補可提前登記:不再受「缺額 > 0」限制,超出缺額者排候補,
--    有人請假時依登記先後自動遞補(確定性不變)。
-- 2. 報名窗口:賽前 N 天才開放登記(season_rules.sub_signup_open_days,預設 7)。
-- 3. 臨打 = 無帳號候補:session_subs.guest_name 姓名制,
--    任何登入者(隊員/管理員)皆可幫朋友登記,登記者可代為取消。
-- 4. 計費只算「確定上場」者(候補中不計費)。
-- =============================================================

-- ---------- schema ----------
alter table season_rules
  add column sub_signup_open_days int not null default 7
  check (sub_signup_open_days > 0);

alter table session_subs alter column profile_id drop not null;
alter table session_subs add column guest_name text;
alter table session_subs
  add constraint chk_sub_identity check (num_nonnulls(profile_id, guest_name) >= 1);

-- 更新欄位保護:仍僅允許改 status
create or replace function fn_session_subs_guard() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.session_id is distinct from old.session_id
     or new.profile_id is distinct from old.profile_id
     or new.guest_name is distinct from old.guest_name
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'session_subs 僅允許變更 status 欄位';
  end if;
  return new;
end $$;

-- ---------- views 重建(欄位異動需 drop 後重建) ----------
drop view if exists v_session_matching;
drop view if exists v_session_slots;
drop view if exists v_member_session_status;
drop view if exists v_active_rules;

create view v_active_rules as
select distinct on (season_id) *
from season_rules
order by season_id, effective_from desc, created_at desc;

-- 成員 × 場次狀態(邏輯不變:候補超額時所有有效請假者皆已遞補)
create view v_member_session_status as
with base as (
  select
    s.id          as session_id,
    s.season_id,
    s.session_date,
    s.start_time,
    s.status      as session_status,
    sm.id         as season_member_id,
    sm.profile_id,
    le.type       as latest_event_type,
    le.created_at as latest_event_at,
    r.leave_deadline_hours,
    r.refund_requires_sub,
    fn_session_start_at(s) as session_start_at
  from sessions s
  join season_members sm
    on sm.season_id = s.season_id
   and sm.joined_at <= s.session_date
  join v_active_rules r on r.season_id = s.season_id
  left join v_latest_events le
    on le.session_id = s.id and le.season_member_id = sm.id
),
classified as (
  select *,
    case
      when session_status = 'cancelled' then 'session_cancelled'
      when latest_event_type = 'leave'
       and latest_event_at < session_start_at - make_interval(hours => leave_deadline_hours)
        then 'leave_valid'
      when latest_event_type = 'leave' then 'leave_late'
      else 'attend'
    end as base_status
  from base
),
sub_counts as (
  select session_id, count(*) as effective_subs
  from session_subs
  where status in ('signed_up', 'no_show')
  group by session_id
),
ranked as (
  select c.*,
    coalesce(sc.effective_subs, 0) as effective_subs,
    case when c.base_status = 'leave_valid' then
      row_number() over (
        partition by c.session_id, (c.base_status = 'leave_valid')
        order by c.latest_event_at asc, c.season_member_id
      )
    end as leave_rank
  from classified c
  left join sub_counts sc on sc.session_id = c.session_id
)
select
  session_id,
  season_id,
  session_date,
  start_time,
  session_start_at,
  season_member_id,
  profile_id,
  latest_event_at as leave_at,
  leave_rank,
  case
    when base_status = 'leave_valid' then
      case
        when not refund_requires_sub then 'leave_matched'
        when leave_rank <= effective_subs then 'leave_matched'
        else 'leave_pending'
      end
    else base_status
  end as status
from ranked;

-- 缺額 + 候補人數統計
create view v_session_slots as
select
  s.id as session_id,
  s.season_id,
  s.session_date,
  s.start_time,
  s.end_time,
  s.venue,
  s.status as session_status,
  fn_session_start_at(s) as session_start_at,
  coalesce(l.valid_leaves, 0)  as valid_leaves,
  coalesce(sb.effective_subs, 0) as effective_subs,
  case when s.status = 'cancelled' then 0
       else greatest(coalesce(l.valid_leaves, 0) - coalesce(sb.effective_subs, 0), 0)
  end as open_slots,
  case when s.status = 'cancelled' then 0
       else greatest(coalesce(sb.effective_subs, 0) - coalesce(l.valid_leaves, 0), 0)
  end as waitlist_count
from sessions s
left join (
  select session_id, count(*) as valid_leaves
  from v_member_session_status
  where status in ('leave_matched', 'leave_pending')
  group by session_id
) l on l.session_id = s.id
left join (
  select session_id, count(*) as effective_subs
  from session_subs
  where status in ('signed_up', 'no_show')
  group by session_id
) sb on sb.session_id = s.id;

-- 候補名單(每筆報名的順位、是否確定上場、單場費)
create view v_sub_entries as
with ranked as (
  select ss.*,
    row_number() over (partition by ss.session_id order by ss.created_at asc, ss.id) as sub_rank
  from session_subs ss
  where ss.status in ('signed_up', 'no_show')
)
select
  r.id as session_sub_id,
  r.session_id,
  s.season_id,
  r.profile_id,
  r.guest_name,
  r.created_by,
  r.status,
  r.created_at,
  r.sub_rank,
  coalesce(sl.valid_leaves, 0) as valid_leaves,
  s.status as session_status,
  s.session_date,
  s.start_time,
  s.end_time,
  s.venue,
  fn_session_start_at(s) as session_start_at,
  (s.status = 'scheduled' and r.sub_rank <= coalesce(sl.valid_leaves, 0)) as confirmed,
  ru.sub_fee_per_session
from ranked r
join sessions s on s.id = r.session_id
join v_active_rules ru on ru.season_id = s.season_id
left join (
  select session_id, count(*) as valid_leaves
  from v_member_session_status
  where status in ('leave_matched', 'leave_pending')
  group by session_id
) sl on sl.session_id = r.session_id;

-- 管理員配對表:請假 ↔ 候補一對一配對 + 超額候補列(member 欄為 null)
create view v_session_matching as
select
  m.session_id,
  m.season_id,
  m.season_member_id,
  m.profile_id as member_profile_id,
  m.leave_at,
  m.leave_rank,
  m.status as member_status,
  e.session_sub_id,
  e.profile_id as sub_profile_id,
  e.guest_name as sub_guest_name,
  e.status as sub_status,
  e.created_at as sub_signed_up_at,
  e.sub_rank
from v_member_session_status m
left join v_sub_entries e
  on e.session_id = m.session_id and e.sub_rank = m.leave_rank
where m.status in ('leave_matched', 'leave_pending', 'leave_late')
union all
select
  e.session_id,
  e.season_id,
  null, null, null, null, null,
  e.session_sub_id,
  e.profile_id,
  e.guest_name,
  e.status,
  e.created_at,
  e.sub_rank
from v_sub_entries e
where not e.confirmed and e.session_status = 'scheduled';

alter view v_active_rules set (security_invoker = true);
alter view v_member_session_status set (security_invoker = true);
alter view v_session_slots set (security_invoker = true);
alter view v_sub_entries set (security_invoker = true);
alter view v_session_matching set (security_invoker = true);

grant select on v_active_rules, v_member_session_status, v_session_slots,
  v_sub_entries, v_session_matching to authenticated;

-- ---------- RLS:登記者也能看到自己代登的候補 ----------
drop policy session_subs_select_own on session_subs;
create policy session_subs_select_own on session_subs
  for select using (
    profile_id = auth.uid() or created_by = auth.uid() or is_admin()
  );

-- ---------- 報名 / 取消 RPC 重寫 ----------
drop function if exists fn_sub_signup(uuid);
drop function if exists fn_sub_withdraw(uuid);

-- 報名候補:p_guest_name 為 null = 本人報名;有值 = 幫無帳號朋友登記。
-- 不限缺額(超額排候補);僅限報名窗口內(賽前 sub_signup_open_days 天起)。
create function fn_sub_signup(p_session_id uuid, p_guest_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_session sessions;
  v_season seasons;
  v_rule v_active_rules;
  v_start timestamptz;
  v_existing session_subs;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;

  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select * into v_session from sessions where id = p_session_id;
  if not found then raise exception '場次不存在'; end if;
  if v_session.status = 'cancelled' then raise exception '場次已取消'; end if;

  v_start := fn_session_start_at(v_session);
  if now() >= v_start then raise exception '場次已開打'; end if;

  select * into v_season from seasons where id = v_session.season_id;
  if v_season.status <> 'active' then raise exception '本季非進行中'; end if;

  select * into v_rule from v_active_rules where season_id = v_session.season_id;
  if now() < v_start - make_interval(days => v_rule.sub_signup_open_days) then
    raise exception '尚未開放報名(賽前 % 天起可登記)', v_rule.sub_signup_open_days;
  end if;

  if p_guest_name is not null and length(trim(p_guest_name)) > 0 then
    insert into session_subs (session_id, profile_id, guest_name, status, created_by)
    values (p_session_id, null, trim(p_guest_name), 'signed_up', auth.uid());
    return;
  end if;

  select * into v_existing from session_subs
  where session_id = p_session_id and profile_id = auth.uid();

  if found then
    if v_existing.status = 'signed_up' then raise exception '您已報名本場'; end if;
    if v_existing.status = 'no_show' then raise exception '本場狀態異常,請聯繫管理員'; end if;
    update session_subs set status = 'signed_up' where id = v_existing.id;
  else
    insert into session_subs (session_id, profile_id, status, created_by)
    values (p_session_id, auth.uid(), 'signed_up', auth.uid());
  end if;
end $$;

-- 取消報名:本人、當初代登者、或管理員
create function fn_sub_withdraw(p_session_sub_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sub session_subs;
  v_session sessions;
  v_season seasons;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;

  select * into v_sub from session_subs where id = p_session_sub_id;
  if not found then raise exception '報名紀錄不存在'; end if;

  -- 注意 NULL 安全:訪客列 profile_id 為 NULL,直接用 = 會讓整個條件變 NULL
  if not (coalesce(v_sub.profile_id = auth.uid(), false)
          or coalesce(v_sub.created_by = auth.uid(), false)
          or is_admin()) then
    raise exception '只有本人或代登者可以取消';
  end if;
  if v_sub.status <> 'signed_up' then raise exception '此報名已非有效狀態'; end if;

  select * into v_session from sessions where id = v_sub.session_id;
  if now() >= fn_session_start_at(v_session) then raise exception '場次已開打,無法取消'; end if;

  select * into v_season from seasons where id = v_session.season_id;
  if v_season.status = 'settled' then raise exception '本季已結算'; end if;

  update session_subs set status = 'withdrawn' where id = p_session_sub_id;
end $$;

-- ---------- 候補端查詢 RPC 重寫 ----------
-- 報名窗口內的未來場次(不論有無缺額,皆可排候補)
drop function if exists fn_open_sub_sessions();
create function fn_open_sub_sessions()
returns table (
  session_id uuid,
  season_id uuid,
  season_name text,
  session_date date,
  start_time time,
  end_time time,
  venue text,
  open_slots int,
  waitlist_count int,
  sub_fee int,
  my_status text
)
language sql stable security definer set search_path = public as $$
  select
    sl.session_id,
    sl.season_id,
    se.name,
    sl.session_date,
    sl.start_time,
    sl.end_time,
    sl.venue,
    sl.open_slots::int,
    sl.waitlist_count::int,
    r.sub_fee_per_session,
    ss.status
  from v_session_slots sl
  join seasons se on se.id = sl.season_id and se.status = 'active'
  join v_active_rules r on r.season_id = sl.season_id
  left join session_subs ss
    on ss.session_id = sl.session_id and ss.profile_id = auth.uid()
  where sl.session_status = 'scheduled'
    and sl.session_start_at > now()
    and now() >= sl.session_start_at - make_interval(days => r.sub_signup_open_days)
  order by sl.session_date, sl.start_time
$$;

-- 我的報名(本人 + 我代登的朋友),含順位與確定上場狀態
create function fn_my_sub_entries()
returns table (
  session_sub_id uuid,
  session_id uuid,
  season_id uuid,
  session_date date,
  start_time time,
  venue text,
  display_name text,
  is_guest boolean,
  status text,
  sub_rank int,
  confirmed boolean,
  fee int,
  started boolean
)
language sql stable security definer set search_path = public as $$
  select
    e.session_sub_id,
    e.session_id,
    e.season_id,
    e.session_date,
    e.start_time,
    e.venue,
    coalesce(p.display_name, e.guest_name),
    e.guest_name is not null,
    e.status,
    e.sub_rank::int,
    e.confirmed,
    e.sub_fee_per_session,
    now() >= e.session_start_at
  from v_sub_entries e
  left join profiles p on p.id = e.profile_id
  join seasons se on se.id = e.season_id and se.status = 'active'
  where e.profile_id = auth.uid() or e.created_by = auth.uid()
  order by e.session_date, e.start_time, e.sub_rank
$$;

-- ---------- 計費:只算「確定上場」者 ----------
create or replace function fn_sub_balance(p_profile_id uuid, p_season_id uuid)
returns table (
  profile_id uuid,
  sub_sessions int,
  fee_per_session int,
  amount_due int,
  paid_total int,
  balance int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_fee int;
  v_count int;
  v_paid int;
begin
  if auth.uid() is not null and not is_admin() and p_profile_id <> auth.uid() then
    raise exception '無權查詢他人帳務';
  end if;

  select r.sub_fee_per_session into v_fee from v_active_rules r where r.season_id = p_season_id;
  if v_fee is null then return; end if;

  select count(*) into v_count
  from v_sub_entries e
  where e.profile_id = p_profile_id
    and e.season_id = p_season_id
    and e.confirmed;

  select coalesce(sum(pe.amount), 0) into v_paid
  from payment_events pe
  join session_subs ss on ss.id = pe.session_sub_id
  join sessions s on s.id = ss.session_id
  where ss.profile_id = p_profile_id and s.season_id = p_season_id;

  return query select p_profile_id, v_count, v_fee, v_count * v_fee, v_paid, v_paid - v_count * v_fee;
end $$;

-- ---------- 權限 ----------
revoke execute on function
  fn_sub_signup(uuid, text),
  fn_sub_withdraw(uuid),
  fn_open_sub_sessions(),
  fn_my_sub_entries()
from public, anon;

grant execute on function
  fn_sub_signup(uuid, text),
  fn_sub_withdraw(uuid),
  fn_open_sub_sessions(),
  fn_my_sub_entries()
to authenticated;
