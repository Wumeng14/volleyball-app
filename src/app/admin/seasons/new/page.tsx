import { createSeason } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Card } from "@/components/ui";

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";

export default function NewSeasonPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">建立季</h1>
      <form action={createSeason} className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-semibold">1. 基本資料</h2>
          <label className="block text-sm">
            季名稱
            <input name="name" required placeholder="2026 夏季" className={inputCls} />
          </label>
          <label className="block text-sm">
            開始日期
            <input name="start_date" type="date" required className={inputCls} />
          </label>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">2. 規則</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              季費(NTD)
              <input name="season_fee" type="number" required min={0} className={inputCls} />
            </label>
            <label className="block text-sm">
              每場退費額
              <input name="refund_per_session" type="number" required min={0} className={inputCls} />
            </label>
            <label className="block text-sm">
              遞補單場費
              <input name="sub_fee_per_session" type="number" defaultValue={225} min={0} className={inputCls} />
            </label>
            <label className="block text-sm">
              請假截止(賽前小時)
              <input name="leave_deadline_hours" type="number" defaultValue={2} min={0} className={inputCls} />
            </label>
            <label className="block text-sm">
              候補報名開放(賽前天數)
              <input name="sub_signup_open_days" type="number" defaultValue={7} min={1} className={inputCls} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="refund_requires_sub" type="checkbox" defaultChecked />
            請假須有遞補到位才退費(場次取消除外)
          </label>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">3. 批次產生場次(每週固定時段)</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              星期
              <select name="weekday" className={inputCls} defaultValue="3">
                <option value="1">週一</option>
                <option value="2">週二</option>
                <option value="3">週三</option>
                <option value="4">週四</option>
                <option value="5">週五</option>
                <option value="6">週六</option>
                <option value="0">週日</option>
              </select>
            </label>
            <label className="block text-sm">
              週數(場數)
              <input name="weeks" type="number" required min={1} max={52} defaultValue={12} className={inputCls} />
            </label>
            <label className="block text-sm">
              開始時間
              <input name="start_time" type="time" required defaultValue="19:00" className={inputCls} />
            </label>
            <label className="block text-sm">
              結束時間
              <input name="end_time" type="time" required defaultValue="21:00" className={inputCls} />
            </label>
            <label className="block text-sm">
              場地
              <input name="venue" required placeholder="市立體育館 A 場" className={inputCls} />
            </label>
            <label className="block text-sm">
              容量(人)
              <input name="capacity" type="number" defaultValue={18} min={1} className={inputCls} />
            </label>
          </div>
          <p className="text-xs text-zinc-400">
            建立後可於季頁面逐場調整或新增/取消場次。
          </p>
        </Card>

        <SubmitButton label="建立季與場次" pendingLabel="建立中,請稍候…" />
      </form>
    </div>
  );
}
