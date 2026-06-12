import { settleSeason } from "@/app/admin/actions";
import { ActionButton } from "@/components/ActionForm";
import { Card } from "@/components/ui";
import { formatNTD } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function SettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seasonId } = await params;
  const supabase = await createClient();

  const { data: season } = await supabase
    .from("seasons")
    .select("*")
    .eq("id", seasonId)
    .maybeSingle();
  if (!season) notFound();

  const { data: members } = await supabase
    .from("season_members")
    .select("*, profiles(display_name)")
    .eq("season_id", seasonId);

  const isSettled = season.status === "settled";

  // 已結算 → 顯示快照;未結算 → 即時預覽
  const rows = isSettled
    ? ((await supabase
        .from("settlements")
        .select("*")
        .eq("season_id", seasonId)).data ?? []).map((s) => ({
        memberId: s.season_member_id,
        refundableLeaves: s.refundable_leaves,
        refundAmount: s.refund_amount,
        balance: s.balance,
        pending: 0,
      }))
    : await Promise.all(
        (members ?? []).map(async (m) => {
          const { data } = await supabase.rpc("fn_refund_preview", {
            p_season_member_id: m.id,
          });
          const p = (data as Record<string, number>[])?.[0];
          return {
            memberId: m.id,
            refundableLeaves: p?.refundable_leaves ?? 0,
            refundAmount: p?.refund_amount ?? 0,
            balance: p?.balance ?? 0,
            pending: p?.pending_leaves ?? 0,
          };
        })
      );

  const nameOf = new Map(
    (members ?? []).map((m) => [
      m.id,
      (m.profiles as { display_name: string } | null)?.display_name ??
        (m.member_name as string | null) ??
        "(未命名)",
    ])
  );
  const totalPending = rows.reduce((sum, r) => sum + r.pending, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {season.name} — {isSettled ? "結算快照" : "結算預覽"}
        </h1>
        <Link
          href={`/admin/seasons/${seasonId}`}
          className="text-sm text-zinc-500 hover:text-zinc-800"
        >
          ← 回季頁
        </Link>
      </div>

      {!isSettled && totalPending > 0 && (
        <Card className="border-amber-300 bg-amber-50 text-sm text-amber-800">
          ⚠ 目前仍有 {totalPending} 筆「待遞補」請假,結算時將列為不退費。
          確認前可先補登遞補或調整。
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1">成員</th>
              <th className="text-right">可退場次</th>
              <th className="text-right">退費金額</th>
              <th className="text-right">餘額(正 = 應退)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className="border-t border-zinc-100">
                <td className="py-2">{nameOf.get(r.memberId)}</td>
                <td className="text-right">{r.refundableLeaves}</td>
                <td className="text-right">{formatNTD(r.refundAmount)}</td>
                <td
                  className={`text-right font-medium ${
                    r.balance < 0 ? "text-rose-600" : "text-emerald-700"
                  }`}
                >
                  {r.balance >= 0
                    ? `應退 ${formatNTD(r.balance)}`
                    : `應補 ${formatNTD(-r.balance)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center gap-3">
        <a
          href={`/admin/seasons/${seasonId}/settle/csv`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          匯出 CSV
        </a>
        {!isSettled && (
          <ActionButton
            action={settleSeason.bind(null, seasonId)}
            label="確認結算並鎖定本季"
            variant="danger"
            confirmText="結算後本季所有寫入(請假、繳費、遞補)將被鎖定,且無法復原。確定結算?"
          />
        )}
        {isSettled && (
          <span className="text-sm text-zinc-500">
            本季已於結算時鎖定,所有寫入操作已停用。
          </span>
        )}
      </div>
    </div>
  );
}
