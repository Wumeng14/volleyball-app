<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 排球季打管理系統

完整規格見 SPEC.md(v1.2,Final)。不可違背的設計原則:

1. **事實與規則分離** — 出席/請假/遞補/繳費是事件,退費金額是規則套用事實的推導結果。
   資料庫永不儲存計算後的金額(settlements 結算快照除外)。
2. **events / payment_events 只追加** — 禁止 UPDATE/DELETE(有 DB 觸發器硬擋),改帳新增 adjustment 事件。
3. **推導邏輯全在 DB 層**(supabase/migrations/0002_derivations.sql)— 前端只顯示,不在 JS 算錢。
4. **遞補配對確定性** — 依 leave 事件 created_at 升冪,前 m 名(m = 有效遞補數)獲退費資格,無人工裁量。
5. **RLS 注意事項** — view 一律 security_invoker = true;跨人計算(配對排名、缺額統計)
   走 security definer 函式且內建本人/管理員授權檢查。

改動推導邏輯後必跑:`npx supabase test db`(supabase/tests/acceptance_test.sql,對應規格第 5 節案例)。
