import {
  CancelEntryButton,
  GuestSignupForm,
  SubSignupButton,
} from "@/components/SubToggle";
import { Badge, Card } from "@/components/ui";
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
  waitlist_count: number;
  sub_fee: number;
  my_status: string | null;
};

type MyEntry = {
  session_sub_id: string;
  session_id: string;
  season_id: string;
  session_date: string;
  start_time: string;
  venue: string;
  display_name: string;
  is_guest: boolean;
  status: string;
  sub_rank: number;
  confirmed: boolean;
  fee: number;
  started: boolean;
};

export default async function SubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: sessionsData }, { data: entriesData }] = await Promise.all([
    supabase.rpc("fn_open_sub_sessions"),
    supabase.rpc("fn_my_sub_entries"),
  ]);
  const sessions = (sessionsData ?? []) as OpenSession[];
  const entries = (entriesData ?? []) as MyEntry[];

  // 我的應繳統計(只算確定上場、未開打的也算 — 排上即占名額)
  const seasonIds = [...new Set(entries.map((e) => e.season_id))];
  const balances = (
    await Promise.all(
      seasonIds.map(async (seasonId) => {
        const { data } = await supabase.rpc("fn_sub_balance", {
          p_profile_id: user.id,
          p_season_id: seasonId,
        });
        return (data as Record<string, number>[] | null)?.[0];
      })
    )
  ).filter((b): b is Record<string, number> => Boolean(b && b.sub_sessions > 0));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">候補報名</h1>
        <p className="mt-1 text-sm text-zinc-500">
          場次於開賽前開放登記(依季規則,預設賽前 7 天),先到先得;
          有人請假時依登記順序自動遞補上場。也可以幫沒有帳號的朋友代登。
        </p>
      </header>

      {/* 開放報名的場次 */}
      <section className="space-y-2">
        {sessions.length === 0 && (
          <Card className="text-sm text-zinc-500">
            目前沒有開放報名的場次(開賽前 7 天才開放)
          </Card>
        )}
        {sessions.map((s) => (
          <Card key={s.session_id} className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {formatDate(s.session_date)} {formatTime(s.start_time)}–
                  {formatTime(s.end_time)}
                </p>
                <p className="truncate text-sm text-zinc-500">{s.venue}</p>
                <p className="mt-1 text-sm">
                  {s.open_slots > 0 ? (
                    <span className="font-semibold text-emerald-700">
                      缺 {s.open_slots} 人
                    </span>
                  ) : (
                    <span className="text-zinc-500">目前無缺額</span>
                  )}
                  {s.waitlist_count > 0 && (
                    <span className="ml-2 text-amber-600">
                      候補中 {s.waitlist_count} 人
                    </span>
                  )}
                  <span className="ml-3 text-zinc-500">
                    單場費 {formatNTD(s.sub_fee)}
                  </span>
                </p>
              </div>
              {s.my_status === "signed_up" ? (
                <Badge tone="green">已報名</Badge>
              ) : (
                <SubSignupButton sessionId={s.session_id} />
              )}
            </div>
            <GuestSignupForm sessionId={s.session_id} />
          </Card>
        ))}
      </section>

      {/* 我的報名(本人 + 我代登的朋友) */}
      {entries.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">
            我的報名
          </h2>
          <div className="space-y-2">
            {entries.map((e) => (
              <Card
                key={e.session_sub_id}
                className="flex items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {e.display_name}
                    {e.is_guest && (
                      <span className="ml-1 text-xs text-zinc-400">(代登)</span>
                    )}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {formatDate(e.session_date)} {formatTime(e.start_time)}{" "}
                    {e.venue}
                  </p>
                </div>
                {e.status === "no_show" ? (
                  <Badge tone="red">未到場</Badge>
                ) : e.confirmed ? (
                  <Badge tone="green">確定上場 · {formatNTD(e.fee)}</Badge>
                ) : (
                  <Badge tone="yellow">候補第 {e.sub_rank} 順位</Badge>
                )}
                {!e.started && e.status === "signed_up" && (
                  <CancelEntryButton
                    sessionSubId={e.session_sub_id}
                    label={e.display_name}
                  />
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* 我的帳務 */}
      {balances.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">
            我的候補帳務
          </h2>
          {balances.map((b, i) => (
            <Card key={i}>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-zinc-500">確定上場</dt>
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
          ))}
        </section>
      )}
    </div>
  );
}
