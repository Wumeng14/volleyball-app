-- =============================================================
-- v1.4 管理強化
-- 1. 刪除季:fn_admin_delete_season — 連動刪除場次/事件/帳務。
--    events / payment_events 的只追加觸發器在此函式內暫時停用
--    (整個刪除在單一交易內,不影響其他約束)。
-- 2. 姓名制成員:season_members.member_name,管理員可直接用姓名
--    建立名單(不必等對方 LINE 登入),之後可綁定帳號。
-- 3. 刪除成員:fn_admin_delete_member — 僅限無請假/繳費紀錄者
--    (誤加情境);有紀錄者請改用「標記退出」保留事實。
-- =============================================================

-- ---------- 姓名制成員 ----------
alter table season_members alter column profile_id drop not null;
alter table season_members add column member_name text;
alter table season_members
  add constraint chk_member_identity check (num_nonnulls(profile_id, member_name) >= 1);

-- ---------- 刪除季 ----------
create or replace function fn_admin_delete_season(p_season_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_season seasons;
begin
  if not is_admin() then raise exception '僅管理員可刪除季'; end if;

  select * into v_season from seasons where id = p_season_id;
  if not found then raise exception '季不存在'; end if;

  -- 只追加觸發器暫時停用,允許本交易內的連動刪除
  alter table events disable trigger trg_events_append_only;
  alter table payment_events disable trigger trg_payment_events_append_only;

  delete from seasons where id = p_season_id;

  alter table events enable trigger trg_events_append_only;
  alter table payment_events enable trigger trg_payment_events_append_only;
end $$;

-- ---------- 刪除成員(僅限無紀錄者) ----------
create or replace function fn_admin_delete_member(p_season_member_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_events int;
  v_payments int;
begin
  if not is_admin() then raise exception '僅管理員可移除成員'; end if;

  if not exists (select 1 from season_members where id = p_season_member_id) then
    raise exception '成員不存在';
  end if;

  select count(*) into v_events from events where season_member_id = p_season_member_id;
  select count(*) into v_payments from payment_events where season_member_id = p_season_member_id;

  if v_events > 0 or v_payments > 0 then
    raise exception '此成員已有請假或繳費紀錄,請改用「標記退出」保留帳務事實';
  end if;

  delete from season_members where id = p_season_member_id;
end $$;

-- ---------- 綁定帳號(姓名制成員 → LINE 帳號) ----------
create or replace function fn_admin_link_member(p_season_member_id uuid, p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member season_members;
begin
  if not is_admin() then raise exception '僅管理員可綁定帳號'; end if;

  select * into v_member from season_members where id = p_season_member_id;
  if not found then raise exception '成員不存在'; end if;
  if v_member.profile_id is not null then raise exception '此成員已綁定帳號'; end if;

  if exists (
    select 1 from season_members
    where season_id = v_member.season_id and profile_id = p_profile_id
  ) then
    raise exception '該帳號已是本季成員';
  end if;

  update season_members set profile_id = p_profile_id where id = p_season_member_id;
end $$;

revoke execute on function
  fn_admin_delete_season(uuid),
  fn_admin_delete_member(uuid),
  fn_admin_link_member(uuid, uuid)
from public, anon;

grant execute on function
  fn_admin_delete_season(uuid),
  fn_admin_delete_member(uuid),
  fn_admin_link_member(uuid, uuid)
to authenticated;
