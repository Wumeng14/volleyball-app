-- =============================================================
-- 驗收測試(pgTAP)— 對應規格第 5 節案例 1–10
-- 執行:supabase test db
-- 整個檔案在交易內執行並 rollback,不汙染資料。
-- =============================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

-- ---------- Fixtures ----------
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from unnest(array[
  'aaaa0000-0000-0000-0000-000000000001',
  'aaaa0000-0000-0000-0000-000000000002',
  'aaaa0000-0000-0000-0000-000000000003',
  'aaaa0000-0000-0000-0000-000000000004',
  'aaaa0000-0000-0000-0000-000000000005',
  'aaaa0000-0000-0000-0000-000000000006',
  'aaaa0000-0000-0000-0000-000000000007',
  'aaaa0000-0000-0000-0000-000000000008',
  'aaaa0000-0000-0000-0000-000000000009'
]::uuid[]) as id;

insert into profiles (id, line_user_id, display_name, role) values
  ('aaaa0000-0000-0000-0000-000000000001', 'T_admin', '測試管理員', 'admin'),
  ('aaaa0000-0000-0000-0000-000000000002', 'T_m1', '隊員1', 'member'),
  ('aaaa0000-0000-0000-0000-000000000003', 'T_m2', '隊員2', 'member'),
  ('aaaa0000-0000-0000-0000-000000000004', 'T_m3', '隊員3', 'member'),
  ('aaaa0000-0000-0000-0000-000000000005', 'T_m4', '隊員4', 'member'),
  ('aaaa0000-0000-0000-0000-000000000006', 'T_m5', '隊員5(中途加入)', 'member'),
  ('aaaa0000-0000-0000-0000-000000000007', 'T_s1', '遞補1', 'member'),
  ('aaaa0000-0000-0000-0000-000000000008', 'T_s2', '遞補2', 'member'),
  ('aaaa0000-0000-0000-0000-000000000009', 'T_s3', '遞補3', 'member');

insert into seasons (id, name, start_date, end_date, status) values
  ('bbbb0000-0000-0000-0000-000000000001', '測試季', current_date, current_date + 90, 'active'),
  ('bbbb0000-0000-0000-0000-000000000002', '比例季', current_date, current_date + 30, 'active');

insert into season_rules (season_id, season_fee, refund_per_session, sub_fee_per_session, leave_deadline_hours, refund_requires_sub, effective_from, created_by) values
  ('bbbb0000-0000-0000-0000-000000000001', 1800, 150, 225, 2, true, now() - interval '30 days', 'aaaa0000-0000-0000-0000-000000000001'),
  ('bbbb0000-0000-0000-0000-000000000002', 1000, 100, 225, 2, true, now() - interval '30 days', 'aaaa0000-0000-0000-0000-000000000001');

-- 測試季 4 場(皆在未來,離截止還很遠)
insert into sessions (id, season_id, session_date, start_time, end_time, venue) values
  ('cccc0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001', current_date + 7,  '19:00', '21:00', 'A 館'),
  ('cccc0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000001', current_date + 14, '19:00', '21:00', 'A 館'),
  ('cccc0000-0000-0000-0000-000000000004', 'bbbb0000-0000-0000-0000-000000000001', current_date + 21, '19:00', '21:00', 'A 館');

-- 案例 6 用:1 小時後開打的場次(已過截止)
insert into sessions (id, season_id, session_date, start_time, end_time, venue)
select 'cccc0000-0000-0000-0000-000000000003', 'bbbb0000-0000-0000-0000-000000000001',
       t::date, t::time, (t + interval '2 hours')::time, 'A 館'
from (select (now() at time zone fn_app_tz()) + interval '1 hour' as t) x;

insert into season_members (id, season_id, profile_id, joined_at) values
  ('dddd0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000002', current_date),
  ('dddd0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000003', current_date),
  ('dddd0000-0000-0000-0000-000000000003', 'bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000004', current_date),
  ('dddd0000-0000-0000-0000-000000000004', 'bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000005', current_date);

-- 比例季:3 場,m5 於第 1 場後加入(剩 2/3)
insert into sessions (season_id, session_date, start_time, end_time, venue) values
  ('bbbb0000-0000-0000-0000-000000000002', current_date + 3,  '19:00', '21:00', 'B 館'),
  ('bbbb0000-0000-0000-0000-000000000002', current_date + 10, '19:00', '21:00', 'B 館'),
  ('bbbb0000-0000-0000-0000-000000000002', current_date + 17, '19:00', '21:00', 'B 館');
insert into season_members (id, season_id, profile_id, joined_at) values
  ('dddd0000-0000-0000-0000-000000000005', 'bbbb0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000006', current_date + 5);

-- 場次 1:m1、m2、m3 依序請假(時間先後),m4 請假後又取消
insert into events (session_id, season_member_id, type, created_by, created_at) values
  ('cccc0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000001', 'leave', 'aaaa0000-0000-0000-0000-000000000002', now() - interval '5 hours'),
  ('cccc0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000002', 'leave', 'aaaa0000-0000-0000-0000-000000000003', now() - interval '4 hours'),
  ('cccc0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000003', 'leave', 'aaaa0000-0000-0000-0000-000000000004', now() - interval '3 hours'),
  ('cccc0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000004', 'leave', 'aaaa0000-0000-0000-0000-000000000005', now() - interval '3 hours'),
  ('cccc0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000004', 'leave_cancel', 'aaaa0000-0000-0000-0000-000000000005', now() - interval '2 hours');

-- 場次 1:遞補 s1、s2 報名(先到先得)
insert into session_subs (session_id, profile_id, status, created_by, created_at) values
  ('cccc0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000007', 'signed_up', 'aaaa0000-0000-0000-0000-000000000007', now() - interval '2 hours'),
  ('cccc0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000008', 'signed_up', 'aaaa0000-0000-0000-0000-000000000008', now() - interval '1 hour');

-- ---------- 案例 2:3 人請假、2 人遞補 → 最早 2 人已遞補,第 3 人待遞補 ----------
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000001' and season_member_id = 'dddd0000-0000-0000-0000-000000000001'),
  'leave_matched', '案例2:最早請假者 m1 已遞補');
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000001' and season_member_id = 'dddd0000-0000-0000-0000-000000000002'),
  'leave_matched', '案例2:第二請假者 m2 已遞補');
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000001' and season_member_id = 'dddd0000-0000-0000-0000-000000000003'),
  'leave_pending', '案例2:第三請假者 m3 待遞補');

-- ---------- 案例 1:請假後取消 → 出席、退費 0 ----------
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000001' and season_member_id = 'dddd0000-0000-0000-0000-000000000004'),
  'attend', '案例1:請假後取消 → 出席');
select is(
  (select refundable_leaves from fn_refund_preview('dddd0000-0000-0000-0000-000000000004')),
  0, '案例1:取消請假後可退場次 = 0');

-- ---------- 案例 2 續:第 3 位遞補報名 → m3 自動轉已遞補 ----------
insert into session_subs (session_id, profile_id, status, created_by) values
  ('cccc0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000009', 'signed_up', 'aaaa0000-0000-0000-0000-000000000009');
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000001' and season_member_id = 'dddd0000-0000-0000-0000-000000000003'),
  'leave_matched', '案例2:第三位遞補報名後 m3 轉已遞補');

-- ---------- 案例 3:遞補撤銷 → 最晚請假者退回待遞補 ----------
update session_subs set status = 'withdrawn'
where session_id = 'cccc0000-0000-0000-0000-000000000001' and profile_id = 'aaaa0000-0000-0000-0000-000000000009';
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000001' and season_member_id = 'dddd0000-0000-0000-0000-000000000003'),
  'leave_pending', '案例3:遞補撤銷後 m3 退回待遞補');
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000001' and season_member_id = 'dddd0000-0000-0000-0000-000000000001'),
  'leave_matched', '案例3:較早請假者 m1 不受影響');
select is(
  (select open_slots::int from v_session_slots where session_id = 'cccc0000-0000-0000-0000-000000000001'),
  1, '案例3:撤銷後缺額回到 1');

-- ---------- 案例 10:遞補額滿 → 缺額 0、報名被拒 ----------
insert into events (session_id, season_member_id, type, created_by, created_at) values
  ('cccc0000-0000-0000-0000-000000000004', 'dddd0000-0000-0000-0000-000000000001', 'leave', 'aaaa0000-0000-0000-0000-000000000002', now() - interval '2 hours'),
  ('cccc0000-0000-0000-0000-000000000004', 'dddd0000-0000-0000-0000-000000000002', 'leave', 'aaaa0000-0000-0000-0000-000000000003', now() - interval '1 hour');
insert into session_subs (session_id, profile_id, status, created_by) values
  ('cccc0000-0000-0000-0000-000000000004', 'aaaa0000-0000-0000-0000-000000000007', 'signed_up', 'aaaa0000-0000-0000-0000-000000000007'),
  ('cccc0000-0000-0000-0000-000000000004', 'aaaa0000-0000-0000-0000-000000000008', 'signed_up', 'aaaa0000-0000-0000-0000-000000000008');
select is(
  (select open_slots::int from v_session_slots where session_id = 'cccc0000-0000-0000-0000-000000000004'),
  0, '案例10:遞補數 = 請假數 → 缺額 0');

select set_config('request.jwt.claims', '{"sub":"aaaa0000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select fn_sub_signup('cccc0000-0000-0000-0000-000000000004') $$,
  'P0001', '本場已無遞補缺額', '案例10:無缺額時報名被拒');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------- 案例 6:逾期請假(賽前 2 小時內)→ 永不退費、不開名額 ----------
insert into events (session_id, season_member_id, type, created_by) values
  ('cccc0000-0000-0000-0000-000000000003', 'dddd0000-0000-0000-0000-000000000003', 'leave', 'aaaa0000-0000-0000-0000-000000000004');
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000003' and season_member_id = 'dddd0000-0000-0000-0000-000000000003'),
  'leave_late', '案例6:截止後請假 → 逾期');
select is(
  (select open_slots::int from v_session_slots where session_id = 'cccc0000-0000-0000-0000-000000000003'),
  0, '案例6:逾期請假不開放遞補名額');

-- ---------- 案例 5:取消場次 → 全員一律退費、遞補單場費作廢 ----------
insert into events (session_id, season_member_id, type, created_by, created_at) values
  ('cccc0000-0000-0000-0000-000000000002', 'dddd0000-0000-0000-0000-000000000001', 'leave', 'aaaa0000-0000-0000-0000-000000000002', now() - interval '1 hour');
insert into session_subs (session_id, profile_id, status, created_by) values
  ('cccc0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000007', 'signed_up', 'aaaa0000-0000-0000-0000-000000000007');
update sessions set status = 'cancelled' where id = 'cccc0000-0000-0000-0000-000000000002';
select is(
  (select status from v_member_session_status where session_id = 'cccc0000-0000-0000-0000-000000000002' and season_member_id = 'dddd0000-0000-0000-0000-000000000002'),
  'session_cancelled', '案例5:場次取消 → 未請假者也視同退費');
select is(
  (select sub_sessions from fn_sub_balance('aaaa0000-0000-0000-0000-000000000007', 'bbbb0000-0000-0000-0000-000000000001')),
  2, '案例5:取消場次的遞補單場費作廢(3 場報名只計 2 場)');

-- m1 此時:場次1 已遞補 + 場次4 已遞補 + 場次2 取消 = 可退 3 場
select is(
  (select refundable_leaves from fn_refund_preview('dddd0000-0000-0000-0000-000000000001')),
  3, '退費試算:可退場次 = 已遞補 2 + 取消 1');
select is(
  (select refund_amount from fn_refund_preview('dddd0000-0000-0000-0000-000000000001')),
  450, '退費試算:3 × 150 = 450');

-- ---------- 案例 4:季中改規則 150 → 100,試算即時反映 ----------
insert into season_rules (season_id, season_fee, refund_per_session, sub_fee_per_session, leave_deadline_hours, refund_requires_sub, effective_from, created_by) values
  ('bbbb0000-0000-0000-0000-000000000001', 1800, 100, 225, 2, true, now(), 'aaaa0000-0000-0000-0000-000000000001');
select is(
  (select refund_amount from fn_refund_preview('dddd0000-0000-0000-0000-000000000001')),
  300, '案例4:規則改 100 後試算 = 3 × 100 = 300');

-- ---------- 案例 9:中途加入按剩餘場次比例(無條件進位至十位) ----------
select is(
  fn_member_season_fee('dddd0000-0000-0000-0000-000000000005'),
  670, '案例9:1000 × 2/3 = 666.7 → 進位至十位 = 670');

-- ---------- 案例 8:隊員 A 看不到隊員 B 的繳費;不可查他人試算 ----------
insert into payment_events (season_member_id, type, amount, created_by) values
  ('dddd0000-0000-0000-0000-000000000001', 'payment', 1800, 'aaaa0000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims', '{"sub":"aaaa0000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*) from payment_events where season_member_id = 'dddd0000-0000-0000-0000-000000000001'),
  0::bigint, '案例8:RLS — 隊員 B 查不到隊員 A 的繳費');
select throws_ok(
  $$ select * from fn_refund_preview('dddd0000-0000-0000-0000-000000000001') $$,
  'P0001', '無權查詢他人帳務', '案例8:隊員 B 不可查隊員 A 的試算');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------- 案例 7:結算後鎖定所有寫入 ----------
select set_config('request.jwt.claims', '{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select fn_admin_settle_season('bbbb0000-0000-0000-0000-000000000001');
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select status from seasons where id = 'bbbb0000-0000-0000-0000-000000000001'),
  'settled', '案例7:結算後季狀態 = settled');
select is(
  (select count(*) from settlements where season_id = 'bbbb0000-0000-0000-0000-000000000001'),
  4::bigint, '案例7:全員結算快照寫入');

select set_config('request.jwt.claims', '{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ insert into events (session_id, season_member_id, type, created_by)
     values ('cccc0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000001', 'leave', 'aaaa0000-0000-0000-0000-000000000001') $$,
  '42501', null, '案例7:結算後管理員代登也被 RLS 拒絕');
reset role;
select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"aaaa0000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select fn_member_toggle_leave('cccc0000-0000-0000-0000-000000000001', 'leave') $$,
  'P0001', '本季非進行中,無法操作', '案例7:結算後隊員請假被拒');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
