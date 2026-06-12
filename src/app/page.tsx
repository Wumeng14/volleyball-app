import { LeaveToggle } from "@/components/LeaveToggle";
import { Card, StatusBadge } from "@/components/ui";
import { formatDate, formatNTD, formatTime, isPastSession } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type SessionStatus = {
  session_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  session_status: string;
  status: string;
  leave_deadline_at: string;
  season_member_id: string;
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware 會導去 /login

  // 我參加的進行中季
  const { data: memberships } = await supabase
    .from("season_members")
    .select("id, season_id, seasons!inner(id, name, status)")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .eq("seasons.status", "active");

  const membership = memberships?.[0];
  if (!membership) {
    return (
      <Card className="text-center text-zinc-500">
        <p className="text-lg">目前沒有進行中的季</p>
        <p className="mt-2 text-sm">
          若您是遞補者,請到上方「遞補」頁報名場次;若您應為隊員,請聯繫管理員將您加入本季。
        </p>
      </Card>
    );
  }

  const seasonName =
    (membership.seasons as unknown as { name: string }).name ?? "";

  const [{ data: statuses }, { data: previews }] = await Promise.all([
    supabase.rpc("fn_my_session_statuses", {
      p_season_id: membership.season_id,
    }),
    supabase.rpc("fn_refund_preview", {
      p_season_member_id: membership.id,
    }),
  ]);

  const preview = (previews as Record<string, number>[] | null)?.[0];
  const sessions = (statuses ?? []) as SessionStatus[];
  const upcoming = sessions.filter((s) => !isPastSession(s.session_date));
  const past = sessions.filter((s) => isPastSession(s.session_date));
  const now = Date.now();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">{seasonName}</h1>
      </header>

      {/* 退費試算卡 */}
      {preview && (
        <Card className="bg-emerald-50 border-emerald-200">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-sm text-emerald-800">
                已遞補 {preview.refundable_leaves} 場 ×{" "}
                {formatNTD(preview.refund_per_session)}
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">
                預估退費 {formatNTD(preview.refund_amount)}
              </p>
            </div>
            {preview.pending_leaves > 0 && (
              <div className="text-right text-sm text-amber-700">
                待遞補 {preview.pending_leaves} 場
                <p className="text-xs text-amber-600">遞補到位後生效</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 場次列表 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-500">場次</h2>
        {upcoming.length === 0 && (
          <Card className="text-sm text-zinc-500">本季已無未來場次</Card>
        )}
        {upcoming.map((s) => (
          <Card key={s.session_id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {formatDate(s.session_date)} {formatTime(s.start_time)}
              </p>
              <p className="truncate text-sm text-zinc-500">{s.venue}</p>
              <div className="mt-1">
                <StatusBadge status={s.status} />
              </div>
            </div>
            {s.session_status === "scheduled" && (
              <LeaveToggle
                sessionId={s.session_id}
                status={s.status}
                deadlinePassed={new Date(s.leave_deadline_at).getTime() <= now}
              />
            )}
          </Card>
        ))}
      </section>

      {/* 過去場次(折疊) */}
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-zinc-500">
            過去場次({past.length})
          </summary>
          <div className="mt-2 space-y-2">
            {past.map((s) => (
              <Card
                key={s.session_id}
                className="flex items-center justify-between opacity-70"
              >
                <div>
                  <p className="text-sm">
                    {formatDate(s.session_date)} {formatTime(s.start_time)}{" "}
                    <span className="text-zinc-400">{s.venue}</span>
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
