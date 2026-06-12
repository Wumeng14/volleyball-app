import { SubToggle } from "@/components/SubToggle";
import { Card } from "@/components/ui";
import { formatDate, formatNTD, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type OpenSession = {
  session_id: string;
  season_id: string;
  season_name: string;
  session_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  open_slots: number;
  sub_fee: number;
  my_status: string | null;
};

export default async function SubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.rpc("fn_open_sub_sessions");
  const sessions = (data ?? []) as OpenSession[];

  // 我的遞補紀錄(各季)與應繳
  const { data: mySubs } = await supabase
    .from("session_subs")
    .select("id, status, created_at, sessions!inner(session_date, start_time, venue, status, season_id, seasons!inner(name, status))")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  const activeSeasonIds = [
    ...new Set(
      (mySubs ?? [])
        .map((s) => {
          const sess = s.sessions as unknown as {
            season_id: string;
            seasons: { status: string };
          };
          return sess.seasons.status === "active" ? sess.season_id : null;
        })
        .filter((x): x is string => x !== null)
    ),
  ];

  const balances = await Promise.all(
    activeSeasonIds.map(async (seasonId) => {
      const { data: b } = await supabase.rpc("fn_sub_balance", {
        p_profile_id: user.id,
        p_season_id: seasonId,
      });
      return (b as Record<string, number>[] | null)?.[0];
    })
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">遞補場次</h1>
        <p className="mt-1 text-sm text-zinc-500">
          有缺額的場次先到先得,開打前皆可取消報名。
        </p>
      </header>

      <section className="space-y-2">
        {sessions.length === 0 && (
          <Card className="text-sm text-zinc-500">目前沒有開放遞補的場次</Card>
        )}
        {sessions.map((s) => (
          <Card key={s.session_id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {formatDate(s.session_date)} {formatTime(s.start_time)}–
                {formatTime(s.end_time)}
              </p>
              <p className="truncate text-sm text-zinc-500">{s.venue}</p>
              <p className="mt-1 text-sm">
                剩餘缺額{" "}
                <span className="font-semibold text-emerald-700">
                  {s.open_slots}
                </span>
                <span className="ml-3 text-zinc-500">
                  單場費 {formatNTD(s.sub_fee)}
                </span>
              </p>
            </div>
            <SubToggle
              sessionId={s.session_id}
              signedUp={s.my_status === "signed_up"}
              full={s.open_slots <= 0}
            />
          </Card>
        ))}
      </section>

      {balances.filter(Boolean).length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">
            我的遞補帳務
          </h2>
          {balances.filter(Boolean).map(
            (b) =>
              b && (
                <Card key={String(b.profile_id) + String(b.amount_due)}>
                  <dl className="grid grid-cols-2 gap-y-1 text-sm">
                    <dt className="text-zinc-500">遞補場次</dt>
                    <dd className="text-right">{b.sub_sessions} 場</dd>
                    <dt className="text-zinc-500">應繳</dt>
                    <dd className="text-right">{formatNTD(b.amount_due)}</dd>
                    <dt className="text-zinc-500">已繳</dt>
                    <dd className="text-right">{formatNTD(b.paid_total)}</dd>
                    <dt className="font-medium">餘額</dt>
                    <dd
                      className={`text-right font-bold ${
                        b.balance >= 0 ? "text-emerald-700" : "text-rose-600"
                      }`}
                    >
                      {formatNTD(b.balance)}
                    </dd>
                  </dl>
                </Card>
              )
          )}
        </section>
      )}

      {mySubs && mySubs.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">
            我的遞補紀錄
          </h2>
          <div className="space-y-2">
            {mySubs.map((s) => {
              const sess = s.sessions as unknown as {
                session_date: string;
                start_time: string;
                venue: string;
                status: string;
              };
              const statusLabel =
                sess.status === "cancelled"
                  ? "場次取消"
                  : s.status === "signed_up"
                    ? "已報名"
                    : s.status === "withdrawn"
                      ? "已取消"
                      : "未到場";
              return (
                <Card
                  key={s.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span>
                    {formatDate(sess.session_date)} {formatTime(sess.start_time)}{" "}
                    <span className="text-zinc-400">{sess.venue}</span>
                  </span>
                  <span className="text-zinc-500">{statusLabel}</span>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
