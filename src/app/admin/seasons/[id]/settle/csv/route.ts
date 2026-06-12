import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** 結算 CSV 匯出:隊員退費明細 + 遞補者收費明細 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: seasonId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("未登入", { status: 401 });
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") return new NextResponse("僅管理員", { status: 403 });

  const { data: season } = await supabase
    .from("seasons")
    .select("name")
    .eq("id", seasonId)
    .single();

  const { data: members } = await supabase
    .from("season_members")
    .select("*, profiles(display_name)")
    .eq("season_id", seasonId);

  const lines: string[] = [];
  lines.push("=== 隊員結算 ===");
  lines.push("成員,應收季費,已繳,可退場次,退費金額,餘額(正=應退)");

  for (const m of members ?? []) {
    const { data } = await supabase.rpc("fn_refund_preview", {
      p_season_member_id: m.id,
    });
    const p = (data as Record<string, number>[])?.[0];
    const name =
      (m.profiles as { display_name: string } | null)?.display_name ??
      (m.member_name as string | null) ??
      "";
    lines.push(
      [
        name,
        p?.season_fee ?? 0,
        p?.paid_total ?? 0,
        p?.refundable_leaves ?? 0,
        p?.refund_amount ?? 0,
        p?.balance ?? 0,
      ].join(",")
    );
  }

  const { data: entries } = await supabase
    .from("v_sub_entries")
    .select("*")
    .eq("season_id", seasonId)
    .order("session_date");

  const entryIds = (entries ?? []).map((e) => e.session_sub_id as string);
  const { data: subPayments } = entryIds.length
    ? await supabase
        .from("payment_events")
        .select("session_sub_id, amount")
        .in("session_sub_id", entryIds)
    : { data: [] };
  const paidByEntry = new Map<string, number>();
  for (const p of subPayments ?? []) {
    paidByEntry.set(
      p.session_sub_id,
      (paidByEntry.get(p.session_sub_id) ?? 0) + p.amount
    );
  }

  const profileIds = [
    ...new Set(
      (entries ?? []).map((e) => e.profile_id as string | null).filter(Boolean)
    ),
  ] as string[];
  const { data: subProfiles } = profileIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", profileIds)
    : { data: [] };
  const profileName = new Map(
    (subProfiles ?? []).map((p) => [p.id, p.display_name ?? ""])
  );

  lines.push("");
  lines.push("=== 候補/臨打收費(確定上場才計費) ===");
  lines.push("姓名,場次日期,狀態,應繳,已繳");
  for (const e of entries ?? []) {
    if (e.status === "withdrawn") continue;
    const name = e.profile_id
      ? profileName.get(e.profile_id) ?? ""
      : `${e.guest_name}(臨打)`;
    const status =
      e.session_status === "cancelled"
        ? "場次取消"
        : e.status === "no_show"
          ? "未到場"
          : e.confirmed
            ? "確定上場"
            : "候補中";
    lines.push(
      [
        name,
        e.session_date,
        status,
        e.confirmed ? e.sub_fee_per_session : 0,
        paidByEntry.get(e.session_sub_id) ?? 0,
      ].join(",")
    );
  }

  // BOM 讓 Excel 正確以 UTF-8 開啟中文
  const csv = "﻿" + lines.join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="settlement_${encodeURIComponent(
        season?.name ?? seasonId
      )}.csv"`,
    },
  });
}
