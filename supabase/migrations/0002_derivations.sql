-- =============================================================
-- 推導邏輯:請假狀態、遞補配對、退費試算、遞補者帳務
-- 全部為「規則套用事實」的即時推導,不落地任何金額。
-- =============================================================

-- 應用程式時區(場次 date+time 解讀基準)
create or replace function fn_app_tz() returns text
language sql immutable as $$ select 'Asia/Taipei' $$;

-- 管理員判斷(security definer 避免 profiles RLS 遞迴)
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  )
$$;

-- 場次開始時刻(timestamptz)
create or replace function fn_session_start_at(p_session sessions) returns timestamptz
language sql stable as $$
  select (p_session.session_date + p_session.start_time) at time zone fn_app_tz()
$$;

-- -------------------------------------------------------------
-- 生效中規則 = 每季 effective_from 最新一列
-- -------------------------------------------------------------
create or replace view v_active_rules as
select distinct on (season_id) *
from season_rules
order by season_id, effective_from desc, created_at desc;

-- -------------------------------------------------------------
-- 每 (session, member) 最新事件
-- -------------------------------------------------------------
create or replace view v_latest_events as
select distinct on (session_id, season_member_id) *
from events
order by session_id, season_member_id, created_at desc, id desc;

-- -------------------------------------------------------------
-- A+B. 成員 × 場次狀態(含遞補配對)
-- status:
--   attend            出席(無事件 / 最新為 leave_cancel / attend_correction)
--   leave_matched     有效請假且已遞補(可退費)
--   leave_pending     有效請假但待遞補(暫不可退費)
--   leave_late        逾期請假(永不退費,不開放遞補名額)
--   session_cancelled 場次取消(視同有效請假,一律退費)
-- 配對規則:有效遞補數 m(signed_up + no_show;no_show 不釋出配對),
-- 有效請假依 leave 事件 created_at 升冪,前 m 名 = matched。
-- refund_requires_sub = false 時所有有效請假皆 matched。
-- -------------------------------------------------------------
create or replace view v_member_session_status as
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

-- -------------------------------------------------------------
-- 每場缺額統計(遞補端列表 / 報名按鈕開關用)
-- 缺額 = 有效請假數 − 有效遞補數;場次取消則缺額 0
-- -------------------------------------------------------------
create or replace view v_session_slots as
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
  end as open_slots
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

-- -------------------------------------------------------------
-- 管理員用:單場「請假 ↔ 遞補」配對表
-- 遞補依報名時間升冪取得序位,與請假序位一對一配對
-- -------------------------------------------------------------
create or replace view v_session_matching as
with subs_ranked as (
  select ss.*,
    row_number() over (partition by ss.session_id order by ss.created_at asc, ss.id) as sub_rank
  from session_subs ss
  where ss.status in ('signed_up', 'no_show')
)
select
  m.session_id,
  m.season_id,
  m.season_member_id,
  m.profile_id as member_profile_id,
  m.leave_at,
  m.leave_rank,
  m.status as member_status,
  sr.id as session_sub_id,
  sr.profile_id as sub_profile_id,
  sr.status as sub_status,
  sr.created_at as sub_signed_up_at
from v_member_session_status m
left join subs_ranked sr
  on sr.session_id = m.session_id and sr.sub_rank = m.leave_rank
where m.status in ('leave_matched', 'leave_pending', 'leave_late');

-- -------------------------------------------------------------
-- 季費比例(中途加入):季費 × 剩餘場次 / 總場次,無條件進位至十位
-- -------------------------------------------------------------
create or replace function fn_member_season_fee(p_season_member_id uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_member season_members;
  v_fee int;
  v_total int;
  v_remaining int;
begin
  select * into v_member from season_members where id = p_season_member_id;
  if not found then return 0; end if;

  select season_fee into v_fee from v_active_rules where season_id = v_member.season_id;
  if v_fee is null then return 0; end if;

  select count(*),
         count(*) filter (where session_date >= v_member.joined_at)
    into v_total, v_remaining
  from sessions where season_id = v_member.season_id;

  if v_total = 0 or v_remaining >= v_total then
    return v_fee;
  end if;
  return (ceil(v_fee::numeric * v_remaining / v_total / 10) * 10)::int;
end $$;

-- -------------------------------------------------------------
-- C. 退費試算 fn_refund_preview(season_member_id)
-- 可退場次 = 已遞補的有效請假 + 被取消場次
-- 退費金額 = 可退場次 × refund_per_session(生效中規則)
-- 餘額     = 已繳總額 − (季費 − 退費金額);正 = 應退,負 = 應補
-- -------------------------------------------------------------
create or replace function fn_refund_preview(p_season_member_id uuid)
returns table (
  season_member_id uuid,
  refundable_leaves int,
  pending_leaves int,
  late_leaves int,
  cancelled_sessions int,
  refund_per_session int,
  refund_amount int,
  season_fee int,
  paid_total int,
  balance int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_season_id uuid;
  v_rate int;
  v_matched int; v_pending int; v_late int; v_cancelled int;
  v_fee int; v_paid int;
begin
  -- 驗收案例 8:只有本人或管理員可查(auth.uid() 為 null = service role 直連)
  if auth.uid() is not null and not is_admin() and not exists (
    select 1 from season_members sm
    where sm.id = p_season_member_id and sm.profile_id = auth.uid()
  ) then
    raise exception '無權查詢他人帳務';
  end if;

  select sm.season_id into v_season_id from season_members sm where sm.id = p_season_member_id;
  if not found then return; end if;

  select r.refund_per_session into v_rate from v_active_rules r where r.season_id = v_season_id;

  select
    count(*) filter (where m.status = 'leave_matched'),
    count(*) filter (where m.status = 'leave_pending'),
    count(*) filter (where m.status = 'leave_late'),
    count(*) filter (where m.status = 'session_cancelled')
  into v_matched, v_pending, v_late, v_cancelled
  from v_member_session_status m
  where m.season_member_id = p_season_member_id;

  v_fee := fn_member_season_fee(p_season_member_id);

  select coalesce(sum(pe.amount), 0) into v_paid
  from payment_events pe where pe.season_member_id = p_season_member_id;

  return query select
    p_season_member_id,
    (v_matched + v_cancelled),
    v_pending,
    v_late,
    v_cancelled,
    v_rate,
    (v_matched + v_cancelled) * v_rate,
    v_fee,
    v_paid,
    v_paid - (v_fee - (v_matched + v_cancelled) * v_rate);
end $$;

-- -------------------------------------------------------------
-- D. 遞補者帳務 fn_sub_balance(profile_id, season_id)
-- 應繳 = 有效遞補場次(signed_up/no_show,場次未取消)× sub_fee_per_session
-- no_show 線下處理:系統照計應繳,爭議以 adjustment 調整。
-- -------------------------------------------------------------
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
  -- 驗收案例 8:遞補者只能看自己的帳務
  if auth.uid() is not null and not is_admin() and p_profile_id <> auth.uid() then
    raise exception '無權查詢他人帳務';
  end if;

  select r.sub_fee_per_session into v_fee from v_active_rules r where r.season_id = p_season_id;
  if v_fee is null then return; end if;

  select count(*) into v_count
  from session_subs ss
  join sessions s on s.id = ss.session_id
  where ss.profile_id = p_profile_id
    and s.season_id = p_season_id
    and s.status = 'scheduled'           -- 場次取消 → 單場費作廢
    and ss.status in ('signed_up', 'no_show');

  select coalesce(sum(pe.amount), 0) into v_paid
  from payment_events pe
  join session_subs ss on ss.id = pe.session_sub_id
  join sessions s on s.id = ss.session_id
  where ss.profile_id = p_profile_id and s.season_id = p_season_id;

  return query select p_profile_id, v_count, v_fee, v_count * v_fee, v_paid, v_paid - v_count * v_fee;
end $$;

-- -------------------------------------------------------------
-- 寫入用 RPC(隊員請假 / 取消請假)
-- 截止與季狀態檢查集中於此;RLS 另有同等防線。
-- -------------------------------------------------------------
create or replace function fn_member_toggle_leave(p_session_id uuid, p_action text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_session sessions;
  v_member season_members;
  v_rule v_active_rules;
  v_season seasons;
begin
  if p_action not in ('leave', 'leave_cancel') then
    raise exception '不支援的操作: %', p_action;
  end if;

  select * into v_session from sessions where id = p_session_id;
  if not found then raise exception '場次不存在'; end if;
  if v_session.status = 'cancelled' then raise exception '場次已取消'; end if;

  select * into v_season from seasons where id = v_session.season_id;
  if v_season.status <> 'active' then raise exception '本季非進行中,無法操作'; end if;

  select * into v_member from season_members
  where season_id = v_session.season_id and profile_id = auth.uid() and status = 'active';
  if not found then raise exception '您不是本季隊員'; end if;

  select * into v_rule from v_active_rules where season_id = v_session.season_id;

  if now() >= fn_session_start_at(v_session) - make_interval(hours => v_rule.leave_deadline_hours) then
    raise exception '已超過請假截止時間(賽前 % 小時)', v_rule.leave_deadline_hours;
  end if;

  insert into events (session_id, season_member_id, type, created_by)
  values (p_session_id, v_member.id, p_action, auth.uid());
end $$;

-- -------------------------------------------------------------
-- 遞補報名 / 取消報名(advisory lock 序列化避免超額)
-- -------------------------------------------------------------
create or replace function fn_sub_signup(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_session sessions;
  v_season seasons;
  v_open int;
  v_existing session_subs;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;

  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select * into v_session from sessions where id = p_session_id;
  if not found then raise exception '場次不存在'; end if;
  if v_session.status = 'cancelled' then raise exception '場次已取消'; end if;
  if now() >= fn_session_start_at(v_session) then raise exception '場次已開打'; end if;

  select * into v_season from seasons where id = v_session.season_id;
  if v_season.status <> 'active' then raise exception '本季非進行中'; end if;

  select open_slots into v_open from v_session_slots where session_id = p_session_id;
  if coalesce(v_open, 0) <= 0 then raise exception '本場已無遞補缺額'; end if;

  select * into v_existing from session_subs
  where session_id = p_session_id and profile_id = auth.uid();

  if found then
    if v_existing.status = 'signed_up' then raise exception '您已報名本場'; end if;
    if v_existing.status = 'no_show' then raise exception '本場狀態異常,請聯繫管理員'; end if;
    update session_subs set status = 'signed_up', created_at = created_at
    where id = v_existing.id;
  else
    insert into session_subs (session_id, profile_id, status, created_by)
    values (p_session_id, auth.uid(), 'signed_up', auth.uid());
  end if;
end $$;

create or replace function fn_sub_withdraw(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_session sessions;
  v_season seasons;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;

  select * into v_session from sessions where id = p_session_id;
  if not found then raise exception '場次不存在'; end if;
  if now() >= fn_session_start_at(v_session) then raise exception '場次已開打,無法取消'; end if;

  select * into v_season from seasons where id = v_session.season_id;
  if v_season.status = 'settled' then raise exception '本季已結算'; end if;

  update session_subs set status = 'withdrawn'
  where session_id = p_session_id and profile_id = auth.uid() and status = 'signed_up';
  if not found then raise exception '您未報名本場'; end if;
end $$;

-- -------------------------------------------------------------
-- 遞補端列表(security definer:遞補者看缺額統計,不暴露個資)
-- -------------------------------------------------------------
create or replace function fn_open_sub_sessions()
returns table (
  session_id uuid,
  season_id uuid,
  season_name text,
  session_date date,
  start_time time,
  end_time time,
  venue text,
  open_slots int,
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
    r.sub_fee_per_session,
    ss.status
  from v_session_slots sl
  join seasons se on se.id = sl.season_id and se.status = 'active'
  join v_active_rules r on r.season_id = sl.season_id
  left join session_subs ss
    on ss.session_id = sl.session_id and ss.profile_id = auth.uid()
  where sl.session_status = 'scheduled'
    and sl.session_start_at > now()
    and (sl.open_slots > 0 or ss.status = 'signed_up')
  order by sl.session_date, sl.start_time
$$;

-- -------------------------------------------------------------
-- 隊員端:我的場次狀態(security definer:配對排名需要全量事件,
-- 但回傳僅限呼叫者本人的列,不暴露他人資料)
-- -------------------------------------------------------------
create or replace function fn_my_session_statuses(p_season_id uuid)
returns table (
  session_id uuid,
  session_date date,
  start_time time,
  end_time time,
  venue text,
  session_status text,
  status text,
  leave_deadline_at timestamptz,
  season_member_id uuid
)
language sql stable security definer set search_path = public as $$
  select
    m.session_id,
    s.session_date,
    s.start_time,
    s.end_time,
    s.venue,
    s.status,
    m.status,
    m.session_start_at - make_interval(hours => r.leave_deadline_hours),
    m.season_member_id
  from v_member_session_status m
  join sessions s on s.id = m.session_id
  join v_active_rules r on r.season_id = m.season_id
  where m.season_id = p_season_id
    and m.profile_id = auth.uid()
  order by s.session_date, s.start_time
$$;

-- -------------------------------------------------------------
-- 結算:寫入 settlements 快照、鎖定季
-- -------------------------------------------------------------
create or replace function fn_admin_settle_season(p_season_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member record;
  v_preview record;
begin
  if not is_admin() then raise exception '僅管理員可結算'; end if;

  if (select status from seasons where id = p_season_id) <> 'active' then
    raise exception '僅進行中的季可結算';
  end if;

  for v_member in
    select id from season_members where season_id = p_season_id
  loop
    select * into v_preview from fn_refund_preview(v_member.id);
    insert into settlements (season_id, season_member_id, refundable_leaves, refund_amount, balance, settled_by)
    values (p_season_id, v_member.id, v_preview.refundable_leaves, v_preview.refund_amount, v_preview.balance, auth.uid());
  end loop;

  update seasons set status = 'settled' where id = p_season_id;
end $$;

-- -------------------------------------------------------------
-- 函式權限:全部收回 anon / public,只開放給已登入者
-- (security definer 函式內已自帶本人/管理員授權檢查)
-- -------------------------------------------------------------
revoke execute on function
  fn_member_season_fee(uuid),
  fn_refund_preview(uuid),
  fn_sub_balance(uuid, uuid),
  fn_member_toggle_leave(uuid, text),
  fn_sub_signup(uuid),
  fn_sub_withdraw(uuid),
  fn_open_sub_sessions(),
  fn_my_session_statuses(uuid),
  fn_admin_settle_season(uuid)
from public, anon;

grant execute on function
  fn_member_season_fee(uuid),
  fn_refund_preview(uuid),
  fn_sub_balance(uuid, uuid),
  fn_member_toggle_leave(uuid, text),
  fn_sub_signup(uuid),
  fn_sub_withdraw(uuid),
  fn_open_sub_sessions(),
  fn_my_session_statuses(uuid),
  fn_admin_settle_season(uuid)
to authenticated;
