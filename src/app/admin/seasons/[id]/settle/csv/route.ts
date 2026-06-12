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
      (m.profiles as { display_name: string } | null)?.display_name ?? "";
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

  const { data: subs } = await supabase
    .from("session_subs")
    .select("profile_id, sessions!inner(season_id), profiles(display_name)")
    .eq("sessions.season_id", seasonId);

  const subIds = [...new Set((subs ?? []).map((s) => s.profile_id as string))];
  lines.push("");
  lines.push("=== 遞補者收費 ===");
  lines.push("遞補者,遞補場次,應繳,已繳,餘額");
  for (const pid of subIds) {
    const { data } = await supabase.rpc("fn_sub_balance", {
      p_profile_id: pid,
      p_season_id: seasonId,
    });
    const b = (data as Record<string, number>[])?.[0];
    const name = (subs ?? []).find((s) => s.profile_id === pid)
      ?.profiles as unknown as { display_name: string } | null;
    lines.push(
      [
        name?.display_name ?? "",
        b?.sub_sessions ?? 0,
        b?.amount_due ?? 0,
        b?.paid_total ?? 0,
        b?.balance ?? 0,
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
