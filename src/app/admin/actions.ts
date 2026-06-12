"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type ActionResult = { ok: boolean; message: string };

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "操作失敗";
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("未登入");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("僅管理員可操作");
  return { supabase, userId: user.id };
}

/** 季精靈:建立季 + 規則 + 批次產生每週場次 */
export async function createSeason(formData: FormData) {
  const { supabase } = await requireAdmin();

  const name = String(formData.get("name"));
  const startDate = String(formData.get("start_date"));
  const weeks = Number(formData.get("weeks"));
  const weekday = Number(formData.get("weekday")); // 0=日 … 6=六
  const startTime = String(formData.get("start_time"));
  const endTime = String(formData.get("end_time"));
  const venue = String(formData.get("venue"));
  const capacity = Number(formData.get("capacity") || 18);
  const seasonFee = Number(formData.get("season_fee"));
  const refundPerSession = Number(formData.get("refund_per_session"));
  const subFee = Number(formData.get("sub_fee_per_session") || 225);
  const deadlineHours = Number(formData.get("leave_deadline_hours") || 2);
  const requiresSub = formData.get("refund_requires_sub") === "on";

  // 自 start_date 起第一個指定星期,每週展開
  const first = new Date(`${startDate}T00:00:00`);
  const offset = (weekday - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + offset);

  const dates: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(first);
    d.setDate(d.getDate() + i * 7);
    dates.push(d.toISOString().slice(0, 10));
  }

  // 防連點/重複送出:同名且進行中的季已存在就直接導過去,不再重複建立
  const { data: existing } = await supabase
    .from("seasons")
    .select("id")
    .eq("name", name)
    .eq("status", "active")
    .maybeSingle();
  if (existing) redirect(`/admin/seasons/${existing.id}`);

  const { data: season, error: seasonErr } = await supabase
    .from("seasons")
    .insert({
      name,
      start_date: startDate,
      end_date: dates[dates.length - 1],
      status: "active",
    })
    .select("id")
    .single();
  if (seasonErr) throw new Error(errMessage(seasonErr));

  const { error: ruleErr } = await supabase.from("season_rules").insert({
    season_id: season.id,
    season_fee: seasonFee,
    refund_per_session: refundPerSession,
    sub_fee_per_session: subFee,
    leave_deadline_hours: deadlineHours,
    refund_requires_sub: requiresSub,
    sub_signup_open_days: Number(formData.get("sub_signup_open_days") || 7),
  });
  if (ruleErr) throw new Error(errMessage(ruleErr));

  const { error: sessErr } = await supabase.from("sessions").insert(
    dates.map((d) => ({
      season_id: season.id,
      session_date: d,
      start_time: startTime,
      end_time: endTime,
      venue,
      capacity,
    }))
  );
  if (sessErr) throw new Error(errMessage(sessErr));

  revalidatePath("/admin/seasons");
  redirect(`/admin/seasons/${season.id}`);
}

/** 規則管理:修改 = 新增版本(歷史推導即時跟著新規則重算) */
export async function addRuleVersion(
  seasonId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, userId } = await requireAdmin();
  const { error } = await supabase.from("season_rules").insert({
    season_id: seasonId,
    season_fee: Number(formData.get("season_fee")),
    refund_per_session: Number(formData.get("refund_per_session")),
    sub_fee_per_session: Number(formData.get("sub_fee_per_session")),
    leave_deadline_hours: Number(formData.get("leave_deadline_hours")),
    refund_requires_sub: formData.get("refund_requires_sub") === "on",
    sub_signup_open_days: Number(formData.get("sub_signup_open_days") || 7),
    created_by: userId,
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "已新增規則版本,所有試算即時生效" };
}

/** 新增單一場次 */
export async function addSession(
  seasonId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("sessions").insert({
    season_id: seasonId,
    session_date: String(formData.get("session_date")),
    start_time: String(formData.get("start_time")),
    end_time: String(formData.get("end_time")),
    venue: String(formData.get("venue")),
    capacity: Number(formData.get("capacity") || 18),
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "場次已新增" };
}

/** 取消場次:全員視同有效請假一律退費、遞補費作廢(推導層自動處理) */
export async function cancelSession(
  seasonId: string,
  sessionId: string
): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId);
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "場次已取消,該場全員一律退費" };
}

/** 加入季成員 */
export async function addMember(
  seasonId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("season_members").insert({
    season_id: seasonId,
    profile_id: String(formData.get("profile_id")),
    joined_at: String(formData.get("joined_at")),
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "成員已加入" };
}

/** 標記成員退出 */
export async function markMemberQuit(
  seasonId: string,
  memberId: string
): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("season_members")
    .update({ status: "quit" })
    .eq("id", memberId);
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "已標記退出" };
}

/** 管理員代登請假/取消請假/出席補登(created_by 記錄管理員) */
export async function proxyEvent(
  seasonId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, userId } = await requireAdmin();
  const { error } = await supabase.from("events").insert({
    session_id: String(formData.get("session_id")),
    season_member_id: String(formData.get("season_member_id")),
    type: String(formData.get("type")),
    created_by: userId,
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "代登完成" };
}

/** 管理員取消任一筆候補報名(本人沒空取消、或登記錯誤時用) */
export async function adminCancelSub(
  seasonId: string,
  sessionSubId: string
): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("fn_sub_withdraw", {
    p_session_sub_id: sessionSubId,
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "已取消該筆報名" };
}

/** 管理員代登「無帳號臨打」:姓名制,不建帳號 */
export async function createGuestSub(
  seasonId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, userId } = await requireAdmin();
  const displayName = String(formData.get("display_name")).trim();
  if (!displayName) return { ok: false, message: "請輸入臨打姓名" };

  const { error } = await supabase.from("session_subs").insert({
    session_id: String(formData.get("session_id")),
    guest_name: displayName,
    status: "signed_up",
    created_by: userId,
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: `已為 ${displayName} 登記候補` };
}

/** 標記遞補者 no_show(不釋出配對,原請假者照退;費用爭議線下處理) */
export async function markSubNoShow(
  seasonId: string,
  sessionSubId: string
): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("session_subs")
    .update({ status: "no_show" })
    .eq("id", sessionSubId);
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "已標記未到場(配對不變,請假者照退)" };
}

/** 記錄繳費 / 調整(隊員季費或遞補單場費) */
export async function recordPayment(
  seasonId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, userId } = await requireAdmin();
  const target = String(formData.get("target")); // "member:<id>" | "sub:<id>"
  const [kind, id] = target.split(":");
  const { error } = await supabase.from("payment_events").insert({
    season_member_id: kind === "member" ? id : null,
    session_sub_id: kind === "sub" ? id : null,
    type: String(formData.get("type") || "payment"),
    amount: Number(formData.get("amount")),
    note: String(formData.get("note") || "") || null,
    created_by: userId,
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "已記錄" };
}

/** 結算:寫入快照、鎖定本季 */
export async function settleSeason(seasonId: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("fn_admin_settle_season", {
    p_season_id: seasonId,
  });
  revalidatePath(`/admin/seasons/${seasonId}`);
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "結算完成,本季已鎖定" };
}
