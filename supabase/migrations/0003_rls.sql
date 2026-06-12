-- =============================================================
-- RLS 政策
-- 原則:
--   * 管理員:全部讀寫
--   * 隊員:讀自己的事件/繳費/成員資料;寫入一律走 RPC(security definer)
--   * 遞補者:讀自己的報名與繳費;報名/取消走 RPC
--   * 已結算季(settled):所有寫入被拒(驗收案例 7)
--   * 隊員 A 看不到隊員 B 的繳費(驗收案例 8)
-- =============================================================

alter table profiles enable row level security;
alter table seasons enable row level security;
alter table season_rules enable row level security;
alter table sessions enable row level security;
alter table season_members enable row level security;
alter table events enable row level security;
alter table session_subs enable row level security;
alter table payment_events enable row level security;
alter table settlements enable row level security;

-- 季是否進行中(寫入鎖定檢查用)
create or replace function fn_season_is_active(p_season_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from seasons where id = p_season_id and status = 'active')
$$;

-- ---------- profiles ----------
create policy profiles_select_own on profiles
  for select using (id = auth.uid() or is_admin());
create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());
create policy profiles_update_own on profiles
  for update using (id = auth.uid() or is_admin())
  with check (
    -- 禁止自行升權:非管理員不得變更 role
    is_admin() or role = 'member'
  );

-- ---------- seasons / sessions / season_rules:登入者可讀,管理員可寫 ----------
create policy seasons_select on seasons
  for select using (auth.uid() is not null);
create policy seasons_admin_write on seasons
  for all using (is_admin()) with check (is_admin());

create policy sessions_select on sessions
  for select using (auth.uid() is not null);
create policy sessions_admin_insert on sessions
  for insert with check (is_admin() and fn_season_is_active(season_id) or is_admin() and exists (select 1 from seasons where id = season_id and status = 'draft'));
create policy sessions_admin_update on sessions
  for update using (is_admin() and fn_season_is_active(season_id))
  with check (is_admin());
create policy sessions_admin_delete on sessions
  for delete using (is_admin() and exists (select 1 from seasons where id = season_id and status = 'draft'));

create policy season_rules_select on season_rules
  for select using (auth.uid() is not null);
create policy season_rules_admin_insert on season_rules
  for insert with check (is_admin() and not exists (select 1 from seasons where id = season_id and status = 'settled'));

-- ---------- season_members ----------
create policy season_members_select on season_members
  for select using (profile_id = auth.uid() or is_admin());
create policy season_members_admin_insert on season_members
  for insert with check (is_admin() and not exists (select 1 from seasons where id = season_id and status = 'settled'));
create policy season_members_admin_update on season_members
  for update using (is_admin() and fn_season_is_active(season_id))
  with check (is_admin());

-- ---------- events(只追加;隊員寫入走 RPC,此處僅開管理員代登) ----------
create policy events_select_own on events
  for select using (
    is_admin()
    or exists (
      select 1 from season_members sm
      where sm.id = events.season_member_id and sm.profile_id = auth.uid()
    )
  );
create policy events_admin_insert on events
  for insert with check (
    is_admin()
    and exists (
      select 1 from sessions s
      where s.id = events.session_id and fn_season_is_active(s.season_id)
    )
  );

-- ---------- session_subs(報名/撤銷走 RPC;管理員可代登與標 no_show) ----------
create policy session_subs_select_own on session_subs
  for select using (profile_id = auth.uid() or is_admin());
create policy session_subs_admin_insert on session_subs
  for insert with check (
    is_admin()
    and exists (
      select 1 from sessions s
      where s.id = session_subs.session_id and fn_season_is_active(s.season_id)
    )
  );
create policy session_subs_admin_update on session_subs
  for update using (
    is_admin()
    and exists (
      select 1 from sessions s
      where s.id = session_subs.session_id and fn_season_is_active(s.season_id)
    )
  ) with check (is_admin());

-- ---------- payment_events(只追加;管理員記帳;本人可讀自己的) ----------
create policy payment_events_select_own on payment_events
  for select using (
    is_admin()
    or exists (
      select 1 from season_members sm
      where sm.id = payment_events.season_member_id and sm.profile_id = auth.uid()
    )
    or exists (
      select 1 from session_subs ss
      where ss.id = payment_events.session_sub_id and ss.profile_id = auth.uid()
    )
  );
create policy payment_events_admin_insert on payment_events
  for insert with check (
    is_admin()
    and (
      (season_member_id is not null and exists (
        select 1 from season_members sm
        where sm.id = payment_events.season_member_id and fn_season_is_active(sm.season_id)
      ))
      or
      (session_sub_id is not null and exists (
        select 1 from session_subs ss join sessions s on s.id = ss.session_id
        where ss.id = payment_events.session_sub_id and fn_season_is_active(s.season_id)
      ))
    )
  );

-- ---------- settlements(僅 RPC 寫入;本人與管理員可讀) ----------
create policy settlements_select_own on settlements
  for select using (
    is_admin()
    or exists (
      select 1 from season_members sm
      where sm.id = settlements.season_member_id and sm.profile_id = auth.uid()
    )
  );
-- 無 insert policy:寫入僅能透過 fn_admin_settle_season(security definer)

-- ---------- View 權限 ----------
-- PostgreSQL view 預設以 owner 權限執行(繞過 RLS),必須改為 security_invoker
-- 讓底層 RLS 生效:隊員查 view 只看得到自己的列。
-- 需要跨人計算的場景(配對排名、缺額統計)一律改走 security definer 函式:
--   fn_my_session_statuses / fn_open_sub_sessions / fn_refund_preview / fn_sub_balance
alter view v_active_rules set (security_invoker = true);
alter view v_latest_events set (security_invoker = true);
alter view v_member_session_status set (security_invoker = true);
alter view v_session_slots set (security_invoker = true);
alter view v_session_matching set (security_invoker = true);

grant select on v_active_rules, v_latest_events, v_member_session_status,
  v_session_slots, v_session_matching to authenticated;
