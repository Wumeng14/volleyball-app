import {
  addMember,
  addRuleVersion,
  addSession,
  cancelSession,
  createGuestSub,
  markMemberQuit,
  markSubNoShow,
  proxyEvent,
  proxySub,
  recordPayment,
} from "@/app/admin/actions";
import { ActionButton, ActionForm } from "@/components/ActionForm";
import { Badge, Card, StatusBadge } from "@/components/ui";
import { formatDate, formatNTD, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";

export default async function SeasonDetailPage({
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

  const isActive = season.status === "active";

  const [
    { data: sessions },
    { data: rules },
    { data: members },
    { data: slots },
    { data: matching },
    { data: allProfiles },
    { data: seasonSubs },
  ] = await Promise.all([
    supabase
      .from("sessions")
      .select("*")
      .eq("season_id", seasonId)
      .order("session_date"),
    supabase
      .from("season_rules")
      .select("*")
      .eq("season_id", seasonId)
      .order("effective_from", { ascending: false }),
    supabase
      .from("season_members")
      .select("*, profiles(display_name)")
      .eq("season_id", seasonId)
      .order("joined_at"),
    supabase.from("v_session_slots").select("*").eq("season_id", seasonId),
    supabase.from("v_session_matching").select("*").eq("season_id", seasonId),
    supabase.from("profiles").select("id, display_name").order("display_name"),
    supabase
      .from("session_subs")
      .select("*, sessions!inner(season_id, session_date, status), profiles(display_name)")
      .eq("sessions.season_id", seasonId),
  ]);

  const profileName = new Map(
    (allProfiles ?? []).map((p) => [p.id, p.display_name ?? "(未命名)"])
  );
  const memberName = new Map(
    (members ?? []).map((m) => [
      m.id,
      (m.profiles as { display_name: string } | null)?.display_name ?? "(未命名)",
    ])
  );
  const slotBySession = new Map((slots ?? []).map((s) => [s.session_id, s]));

  // 帳務總表
  const memberLedger = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data } = await supabase.rpc("fn_refund_preview", {
        p_season_member_id: m.id,
      });
      return { member: m, preview: (data as Record<string, number>[])?.[0] };
    })
  );

  const subProfileIds = [
    ...new Set((seasonSubs ?? []).map((s) => s.profile_id as string)),
  ];
  const subLedger = await Promise.all(
    subProfileIds.map(async (pid) => {
      const { data } = await supabase.rpc("fn_sub_balance", {
        p_profile_id: pid,
        p_season_id: seasonId,
      });
      return { profileId: pid, balance: (data as Record<string, number>[])?.[0] };
    })
  );

  const activeRule = rules?.[0];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{season.name}</h1>
          <p className="text-sm text-zinc-500">
            {season.start_date} ~ {season.end_date}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={isActive ? "green" : "blue"}>
            {isActive ? "進行中" : season.status === "settled" ? "已結算" : "草稿"}
          </Badge>
          {isActive && (
            <Link
              href={`/admin/seasons/${seasonId}/settle`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              結算 →
            </Link>
          )}
        </div>
      </div>

      {/* ---------- 場次管理 ---------- */}
      <section className="space-y-3">
        <h2 className="font-semibold">場次管理</h2>
        {(sessions ?? []).map((s) => {
          const slot = slotBySession.get(s.id);
          const rows = (matching ?? []).filter((m) => m.session_id === s.id);
          return (
            <Card key={s.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {formatDate(s.session_date)} {formatTime(s.start_time)}–
                    {formatTime(s.end_time)}
                    {s.status === "cancelled" && (
                      <span className="ml-2 text-sm text-rose-600">已取消</span>
                    )}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {s.venue} · 容量 {s.capacity}
                    {slot &&
                      s.status === "scheduled" &&
                      ` · 有效請假 ${slot.valid_leaves} / 遞補 ${slot.effective_subs} / 缺額 ${slot.open_slots}`}
                  </p>
                </div>
                {isActive && s.status === "scheduled" && (
                  <ActionButton
                    action={cancelSession.bind(null, seasonId, s.id)}
                    label="取消場次"
                    variant="danger"
                    confirmText="取消後全員該場一律退費、遞補單場費作廢。確定?"
                  />
                )}
              </div>

              {rows.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm text-emerald-700">
                    請假 ↔ 遞補配對表({rows.length})
                  </summary>
                  <table className="mt-2 w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="py-1">#</th>
                        <th>請假者</th>
                        <th>狀態</th>
                        <th>遞補者</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.season_member_id} className="border-t border-zinc-100">
                          <td className="py-1.5">{r.leave_rank ?? "-"}</td>
                          <td>{memberName.get(r.season_member_id)}</td>
                          <td>
                            <StatusBadge status={r.member_status} />
                          </td>
                          <td>
                            {r.sub_profile_id
                              ? `${profileName.get(r.sub_profile_id)}${r.sub_status === "no_show" ? "(未到)" : ""}`
                              : "—"}
                          </td>
                          <td className="text-right">
                            {isActive && r.session_sub_id && r.sub_status === "signed_up" && (
                              <ActionButton
                                action={markSubNoShow.bind(null, seasonId, r.session_sub_id)}
                                label="標記未到"
                                confirmText="標記遞補者未到場?配對不變、請假者照退,費用線下處理。"
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              {isActive && s.status === "scheduled" && (
                <details>
                  <summary className="cursor-pointer text-sm text-zinc-500">
                    代登(請假 / 遞補 / 臨打)
                  </summary>
                  <div className="mt-2 grid gap-4 sm:grid-cols-3">
                    <ActionForm
                      action={proxyEvent.bind(null, seasonId)}
                      submitLabel="代登事件"
                    >
                      <input type="hidden" name="session_id" value={s.id} />
                      <label className="block text-sm">
                        隊員
                        <select name="season_member_id" className={inputCls}>
                          {(members ?? [])
                            .filter((m) => m.status === "active")
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {memberName.get(m.id)}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        事件
                        <select name="type" className={inputCls}>
                          <option value="leave">請假</option>
                          <option value="leave_cancel">取消請假</option>
                          <option value="attend_correction">出席補登</option>
                        </select>
                      </label>
                    </ActionForm>

                    <ActionForm
                      action={proxySub.bind(null, seasonId)}
                      submitLabel="代登遞補"
                    >
                      <input type="hidden" name="session_id" value={s.id} />
                      <label className="block text-sm">
                        遞補者(已有帳號)
                        <select name="profile_id" className={inputCls}>
                          {(allProfiles ?? []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.display_name ?? "(未命名)"}
                            </option>
                          ))}
                        </select>
                      </label>
                    </ActionForm>

                    <ActionForm
                      action={createGuestSub.bind(null, seasonId)}
                      submitLabel="臨打代登"
                    >
                      <input type="hidden" name="session_id" value={s.id} />
                      <label className="block text-sm">
                        無帳號臨打姓名
                        <input name="display_name" className={inputCls} placeholder="小明" />
                      </label>
                    </ActionForm>
                  </div>
                </details>
              )}
            </Card>
          );
        })}

        {isActive && (
          <Card>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                + 新增場次
              </summary>
              <ActionForm
                action={addSession.bind(null, seasonId)}
                submitLabel="新增"
                className="mt-2"
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <label className="block text-sm">
                    日期
                    <input name="session_date" type="date" required className={inputCls} />
                  </label>
                  <label className="block text-sm">
                    開始
                    <input name="start_time" type="time" required defaultValue="19:00" className={inputCls} />
                  </label>
                  <label className="block text-sm">
                    結束
                    <input name="end_time" type="time" required defaultValue="21:00" className={inputCls} />
                  </label>
                  <label className="block text-sm">
                    場地
                    <input name="venue" required className={inputCls} />
                  </label>
                  <label className="block text-sm">
                    容量
                    <input name="capacity" type="number" defaultValue={18} className={inputCls} />
                  </label>
                </div>
              </ActionForm>
            </details>
          </Card>
        )}
      </section>

      {/* ---------- 成員管理 ---------- */}
      <section className="space-y-3">
        <h2 className="font-semibold">成員管理</h2>
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1">成員</th>
                <th>加入日</th>
                <th>狀態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.id} className="border-t border-zinc-100">
                  <td className="py-2">{memberName.get(m.id)}</td>
                  <td>{m.joined_at}</td>
                  <td>
                    {m.status === "active" ? (
                      <Badge tone="green">在隊</Badge>
                    ) : (
                      <Badge tone="gray">已退出</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    {isActive && m.status === "active" && (
                      <ActionButton
                        action={markMemberQuit.bind(null, seasonId, m.id)}
                        label="標記退出"
                        confirmText={`標記 ${memberName.get(m.id)} 退出本季?`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isActive && (
            <details className="mt-3 border-t border-zinc-100 pt-3">
              <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                + 加入成員
              </summary>
              <ActionForm action={addMember.bind(null, seasonId)} submitLabel="加入">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    選擇使用者(需先 LINE 登入過)
                    <select name="profile_id" className={inputCls}>
                      {(allProfiles ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name ?? "(未命名)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    加入日(中途加入按剩餘場次比例計費)
                    <input
                      name="joined_at"
                      type="date"
                      required
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className={inputCls}
                    />
                  </label>
                </div>
              </ActionForm>
            </details>
          )}
        </Card>
      </section>

      {/* ---------- 規則管理 ---------- */}
      <section className="space-y-3">
        <h2 className="font-semibold">規則(版本化,修改 = 新增版本)</h2>
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1">生效時間</th>
                <th>季費</th>
                <th>每場退費</th>
                <th>遞補單場費</th>
                <th>截止(小時)</th>
                <th>須遞補</th>
              </tr>
            </thead>
            <tbody>
              {(rules ?? []).map((r, i) => (
                <tr key={r.id} className={`border-t border-zinc-100 ${i === 0 ? "font-medium" : "text-zinc-400"}`}>
                  <td className="py-2">
                    {new Date(r.effective_from).toLocaleString("zh-TW")}
                    {i === 0 && <Badge tone="green">生效中</Badge>}
                  </td>
                  <td>{formatNTD(r.season_fee)}</td>
                  <td>{formatNTD(r.refund_per_session)}</td>
                  <td>{formatNTD(r.sub_fee_per_session)}</td>
                  <td>{r.leave_deadline_hours}</td>
                  <td>{r.refund_requires_sub ? "是" : "否"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isActive && activeRule && (
            <details className="mt-3 border-t border-zinc-100 pt-3">
              <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                + 新增規則版本(歷史試算即時重算)
              </summary>
              <ActionForm action={addRuleVersion.bind(null, seasonId)} submitLabel="新增版本">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="block text-sm">
                    季費
                    <input name="season_fee" type="number" defaultValue={activeRule.season_fee} className={inputCls} />
                  </label>
                  <label className="block text-sm">
                    每場退費
                    <input name="refund_per_session" type="number" defaultValue={activeRule.refund_per_session} className={inputCls} />
                  </label>
                  <label className="block text-sm">
                    遞補單場費
                    <input name="sub_fee_per_session" type="number" defaultValue={activeRule.sub_fee_per_session} className={inputCls} />
                  </label>
                  <label className="block text-sm">
                    截止(小時)
                    <input name="leave_deadline_hours" type="number" defaultValue={activeRule.leave_deadline_hours} className={inputCls} />
                  </label>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input name="refund_requires_sub" type="checkbox" defaultChecked={activeRule.refund_requires_sub} />
                  請假須有遞補到位才退費
                </label>
              </ActionForm>
            </details>
          )}
        </Card>
      </section>

      {/* ---------- 帳務總表(隊員) ---------- */}
      <section className="space-y-3">
        <h2 className="font-semibold">帳務總表 — 隊員</h2>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1">成員</th>
                <th className="text-right">應收季費</th>
                <th className="text-right">已繳</th>
                <th className="text-right">已遞補</th>
                <th className="text-right">待遞補</th>
                <th className="text-right">預估退費</th>
                <th className="text-right">餘額</th>
              </tr>
            </thead>
            <tbody>
              {memberLedger.map(({ member, preview }) => (
                <tr key={member.id} className="border-t border-zinc-100">
                  <td className="py-2">{memberName.get(member.id)}</td>
                  <td className="text-right">{preview ? formatNTD(preview.season_fee) : "-"}</td>
                  <td className="text-right">{preview ? formatNTD(preview.paid_total) : "-"}</td>
                  <td className="text-right">{preview?.refundable_leaves ?? "-"}</td>
                  <td className="text-right">{preview?.pending_leaves ?? "-"}</td>
                  <td className="text-right">{preview ? formatNTD(preview.refund_amount) : "-"}</td>
                  <td className={`text-right font-medium ${preview && preview.balance < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                    {preview
                      ? preview.balance >= 0
                        ? `應退 ${formatNTD(preview.balance)}`
                        : `應補 ${formatNTD(-preview.balance)}`
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ---------- 帳務總表(遞補者) ---------- */}
      <section className="space-y-3">
        <h2 className="font-semibold">帳務總表 — 遞補者</h2>
        <Card>
          {subLedger.length === 0 ? (
            <p className="text-sm text-zinc-400">本季尚無遞補報名</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1">遞補者</th>
                  <th className="text-right">遞補場次</th>
                  <th className="text-right">應繳</th>
                  <th className="text-right">已繳</th>
                  <th className="text-right">餘額</th>
                </tr>
              </thead>
              <tbody>
                {subLedger.map(({ profileId, balance }) => (
                  <tr key={profileId} className="border-t border-zinc-100">
                    <td className="py-2">{profileName.get(profileId)}</td>
                    <td className="text-right">{balance?.sub_sessions ?? 0}</td>
                    <td className="text-right">{balance ? formatNTD(balance.amount_due) : "-"}</td>
                    <td className="text-right">{balance ? formatNTD(balance.paid_total) : "-"}</td>
                    <td className={`text-right font-medium ${balance && balance.balance < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {balance ? formatNTD(balance.balance) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {/* ---------- 記錄繳費 ---------- */}
      {isActive && (
        <section className="space-y-3">
          <h2 className="font-semibold">記錄繳費 / 調整</h2>
          <Card>
            <ActionForm action={recordPayment.bind(null, seasonId)} submitLabel="記錄">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block text-sm">
                  對象
                  <select name="target" className={inputCls}>
                    <optgroup label="隊員(季費)">
                      {(members ?? []).map((m) => (
                        <option key={m.id} value={`member:${m.id}`}>
                          {memberName.get(m.id)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="遞補報名(單場費)">
                      {(seasonSubs ?? [])
                        .filter((s) => s.status !== "withdrawn")
                        .map((s) => {
                          const sess = s.sessions as unknown as { session_date: string };
                          return (
                            <option key={s.id} value={`sub:${s.id}`}>
                              {(s.profiles as { display_name: string } | null)?.display_name}{" "}
                              {formatDate(sess.session_date)}
                            </option>
                          );
                        })}
                    </optgroup>
                  </select>
                </label>
                <label className="block text-sm">
                  類型
                  <select name="type" className={inputCls}>
                    <option value="payment">收款</option>
                    <option value="adjustment">調整(可負數)</option>
                  </select>
                </label>
                <label className="block text-sm">
                  金額
                  <input name="amount" type="number" required className={inputCls} />
                </label>
                <label className="block text-sm">
                  備註
                  <input name="note" className={inputCls} placeholder="轉帳末五碼…" />
                </label>
              </div>
            </ActionForm>
          </Card>
        </section>
      )}
    </div>
  );
}
