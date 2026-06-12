# 排球季打管理系統

事件溯源 + 規則分離架構的排球隊季打管理:請假、遞補配對、退費試算、季末結算。
規格見 `SPEC.md`(v1.2)。

## 技術棧

- **前端**:Next.js (App Router) + TypeScript + Tailwind CSS,部署 Vercel Hobby
- **後端**:Supabase Free(PostgreSQL + Auth + RLS + RPC)
- **登入**:LINE Login(隊員/遞補者/管理員皆無密碼)
- **核心原則**:退費金額永不落地,一律由 DB view/RPC 即時從事件推導(結算快照除外)

## 專案結構

```
supabase/
  migrations/0001_schema.sql        資料表 + 只追加觸發器
  migrations/0002_derivations.sql   推導邏輯(請假狀態、遞補配對、退費試算)+ 寫入 RPC
  migrations/0003_rls.sql           RLS 政策(security_invoker views)
  seed.sql                          本地開發種子資料
  tests/acceptance_test.sql         pgTAP 驗收測試(規格第 5 節案例 1–10,25 個斷言)
src/
  app/                              隊員端(/、/me)、遞補端(/sub)、管理員端(/admin)
  app/auth/line/                    LINE OAuth 流程
  lib/supabase/                     server / admin clients
  proxy.ts                          session 刷新 + 登入導向
.github/workflows/
  keepalive.yml                     每 3 天 ping,防 Supabase Free 休眠
  backup.yml                        每週 pg_dump → db-backups 分支
```

## 部署步驟

### 1. Supabase

1. [supabase.com](https://supabase.com) 建立免費專案(region 選 Tokyo 較近)
2. 安裝 [Supabase CLI](https://supabase.com/docs/guides/cli),然後:
   ```bash
   supabase link --project-ref <你的 project ref>
   supabase db push          # 套用 migrations
   ```
3. 記下 Settings → API 的 `URL`、`anon key`、`service_role key`

### 2. LINE Login Channel

1. [LINE Developers Console](https://developers.line.biz/) 建立 Provider → **LINE Login** channel
2. Channel 設定:
   - App type:Web app
   - Callback URL:`https://<你的網域>/auth/line/callback`(本機另加 `http://localhost:3000/auth/line/callback`)
3. 記下 Channel ID 與 Channel secret

### 3. Vercel

1. 專案推上 GitHub,Vercel import
2. 環境變數(見 `.env.example`):
   | 變數 | 說明 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案 URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key(LINE 登入建帳號 / 臨打代登用) |
   | `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` | LINE Login channel |
   | `NEXT_PUBLIC_APP_URL` | 正式網域,如 `https://volleyball.vercel.app` |
3. 部署後把正式網域的 callback URL 補進 LINE channel

### 4. 設定第一位管理員

LINE 登入一次後,到 Supabase SQL Editor:

```sql
update profiles set role = 'admin' where line_user_id = '<你的 LINE user id>';
-- 或用 display_name 找:
update profiles set role = 'admin' where display_name = '你的名字';
```

之後即可在 `/admin/seasons` 用季精靈開季、加成員。

### 5. GitHub Actions secrets(維運必要,不可省略)

Repo → Settings → Secrets and variables → Actions:

| Secret | 用途 |
|---|---|
| `SUPABASE_URL` | keep-alive ping |
| `SUPABASE_ANON_KEY` | keep-alive ping |
| `SUPABASE_DB_URL` | 每週備份(Settings → Database → Connection string URI) |

## 本地開發

```bash
npm install
cp .env.example .env.local   # 填入各 key
npx supabase start           # 需要 Docker;起本地 Supabase
npx supabase db reset        # 套 migrations + seed
npm run dev
```

Seed 內建測試帳號(本地限定,密碼皆 `password123`):`admin@local.test`、`member-a@local.test` 等。
本地測 LINE 登入需在 LINE channel 加 localhost callback。

## 測試

```bash
npx supabase test db   # 跑 supabase/tests/acceptance_test.sql(pgTAP)
```

涵蓋規格第 5 節全部 10 個驗收案例:遞補配對先後順序、配對遞進/回退、
場次取消一律退費、季中改規則即時重算、結算鎖定、RLS 隱私隔離、中途加入比例計費等。

## 設計備忘

- **時區**:場次時間一律以 `Asia/Taipei` 解讀(`fn_app_tz()`)。
- **no_show**:標記遞補者未到場不釋出配對(原請假者照退),費用爭議線下處理,
  系統照計應繳、可用「調整」事件沖銷。
- **events / payment_events 永不 UPDATE/DELETE**(DB 觸發器硬性擋下);
  改帳一律新增調整事件。
- **退費金額不落地**:改 `season_rules` 新版本,全部試算即時反映;
  只有結算當下寫入 `settlements` 快照並鎖季。
