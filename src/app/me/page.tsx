import { Card, StatusBadge } from "@/components/ui";
import { formatDate, formatNTD, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("season_members")
    .select("id, season_id, seasons!inner(name, status)")
    .eq("profile_id", user.id)
    .order("joined_at", { ascending: false });

  if (!memberships || memberships.length === 0) {
    return <Card className="text-zinc-500">尚未加入任何季</Card>;
  }

  return (
    <div className="space-y-8">
      {await Promise.all(
        memberships.map(async (m) => {
          const seasonName = (m.seasons as unknown as { name: string }).name;
          const [{ data: statuses }, { data: previews }, { data: payments }] =
            await Promise.all([
              supabase.rpc("fn_my_session_statuses", {
                p_season_id: m.season_id,
              }),
              supabase.rpc("fn_refund_preview", { p_season_member_id: m.id }),
              supabase
                .from("payment_events")
                .select("*")
                .eq("season_member_id", m.id)
                .order("created_at"),
            ]);

          const preview = (previews as Record<string, number>[] | null)?.[0];
          const leaves = (
            (statuses ?? []) as {
              session_id: string;
              session_date: string;
              start_time: string;
              status: string;
            }[]
          ).filter((s) => s.status !== "attend");

          return (
            <section key={m.id} className="space-y-3">
              <h2 className="text-lg font-bold">{seasonName}</h2>

              {preview && (
                <Card>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-zinc-500">本季季費</dt>
                    <dd className="text-right">{formatNTD(preview.season_fee)}</dd>
                    <dt className="text-zinc-500">已繳</dt>
                    <dd className="text-right">{formatNTD(preview.paid_total)}</dd>
                    <dt className="text-zinc-500">預估退費</dt>
                    <dd className="text-right text-emerald-700">
                      {formatNTD(preview.refund_amount)}
                    </dd>
                    <dt className="font-medium text-zinc-700">目前餘額</dt>
                    <dd
                      className={`text-right font-bold ${
                        preview.balance >= 0 ? "text-emerald-700" : "text-rose-600"
                      }`}
                    >
                      {preview.balance >= 0
                        ? `應退 ${formatNTD(preview.balance)}`
                        : `應補 ${formatNTD(-preview.balance)}`}
                    </dd>
                  </dl>
                </Card>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-500">
                  請假明細
                </h3>
                {leaves.length === 0 ? (
                  <Card className="text-sm text-zinc-400">本季無請假紀錄</Card>
                ) : (
                  <div className="space-y-2">
                    {leaves.map((s) => (
                      <Card
                        key={s.session_id}
                        className="flex items-center justify-between py-3"
                      >
                        <span className="text-sm">
                          {formatDate(s.session_date)} {formatTime(s.start_time)}
                        </span>
                        <StatusBadge status={s.status} />
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-500">
                  繳費紀錄
                </h3>
                {!payments || payments.length === 0 ? (
                  <Card className="text-sm text-zinc-400">尚無繳費紀錄</Card>
                ) : (
                  <div className="space-y-2">
                    {payments.map((p) => (
                      <Card
                        key={p.id}
                        className="flex items-center justify-between py-3 text-sm"
                      >
                        <span className="text-zinc-500">
                          {new Date(p.created_at).toLocaleDateString("zh-TW")}
                          {p.note ? ` · ${p.note}` : ""}
                          {p.type === "adjustment" ? "(調整)" : ""}
                        </span>
                        <span
                          className={
                            p.amount >= 0 ? "text-zinc-900" : "text-rose-600"
                          }
                        >
                          {formatNTD(p.amount)}
                        </span>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
