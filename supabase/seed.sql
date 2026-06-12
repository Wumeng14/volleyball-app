-- =============================================================
-- Seed(本地開發用):管理員 + 4 名隊員 + 2 名遞補者 + 進行中的季
-- 規則:截止 2 小時 / refund_requires_sub = true / 容量 18 / 遞補單場費 225
-- 注意:正式環境的使用者由 LINE Login 建立,本 seed 僅供本地測試。
-- =============================================================

-- 本地 auth.users(密碼皆為 password123,僅本地可用)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  u.email, crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'admin@local.test'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'member-a@local.test'),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'member-b@local.test'),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'member-c@local.test'),
  ('00000000-0000-0000-0000-000000000005'::uuid, 'member-d@local.test'),
  ('00000000-0000-0000-0000-000000000006'::uuid, 'sub-x@local.test'),
  ('00000000-0000-0000-0000-000000000007'::uuid, 'sub-y@local.test')
) as u (id, email)
on conflict (id) do nothing;

insert into profiles (id, line_user_id, display_name, role) values
  ('00000000-0000-0000-0000-000000000001', 'U_admin',   'Ulysses(管理員)', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'U_memberA', '隊員 A', 'member'),
  ('00000000-0000-0000-0000-000000000003', 'U_memberB', '隊員 B', 'member'),
  ('00000000-0000-0000-0000-000000000004', 'U_memberC', '隊員 C', 'member'),
  ('00000000-0000-0000-0000-000000000005', 'U_memberD', '隊員 D', 'member'),
  ('00000000-0000-0000-0000-000000000006', 'U_subX',    '遞補 X', 'member'),
  ('00000000-0000-0000-0000-000000000007', 'U_subY',    '遞補 Y', 'member')
on conflict (id) do nothing;

-- 進行中的季:今天起 12 週,每週三 19:00–21:00
insert into seasons (id, name, start_date, end_date, status) values
  ('10000000-0000-0000-0000-000000000001', '2026 夏季', current_date, current_date + interval '12 weeks', 'active')
on conflict (id) do nothing;

insert into season_rules (season_id, season_fee, refund_per_session, sub_fee_per_session, leave_deadline_hours, refund_requires_sub, effective_from, created_by) values
  ('10000000-0000-0000-0000-000000000001', 1800, 150, 225, 2, true, now(), '00000000-0000-0000-0000-000000000001');

-- 12 場:每週三 19:00,容量 18
insert into sessions (season_id, session_date, start_time, end_time, venue, capacity)
select
  '10000000-0000-0000-0000-000000000001',
  d::date, '19:00', '21:00', '市立體育館 A 場', 18
from generate_series(
  current_date + ((3 - extract(dow from current_date)::int + 7) % 7),
  current_date + ((3 - extract(dow from current_date)::int + 7) % 7) + interval '11 weeks',
  interval '1 week'
) as d;

insert into season_members (season_id, profile_id, joined_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', current_date),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', current_date),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', current_date),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', current_date)
on conflict do nothing;

-- 隊員 A 已繳全額季費
insert into payment_events (season_member_id, type, amount, note, created_by)
select sm.id, 'payment', 1800, '轉帳已繳', '00000000-0000-0000-0000-000000000001'
from season_members sm
where sm.season_id = '10000000-0000-0000-0000-000000000001'
  and sm.profile_id = '00000000-0000-0000-0000-000000000002';
