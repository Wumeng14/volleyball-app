"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/** 管理員 ↔ 一般成員視角切換(僅影響畫面,權限仍由 RLS 把關) */
export async function toggleViewAsMember() {
  const cookieStore = await cookies();
  const current = cookieStore.get("view_as_member")?.value === "1";
  if (current) {
    cookieStore.delete("view_as_member");
  } else {
    cookieStore.set("view_as_member", "1", { path: "/", maxAge: 60 * 60 * 24 });
  }
  revalidatePath("/", "layout");
  redirect("/");
}

type ActionResult = { ok: boolean; message: string };

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "操作失敗,請稍後再試";
}

/** 隊員請假 / 取消請假(截止與資格檢查在 DB RPC 內) */
export async function toggleLeave(
  sessionId: string,
  action: "leave" | "leave_cancel"
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_member_toggle_leave", {
    p_session_id: sessionId,
    p_action: action,
  });
  revalidatePath("/");
  if (error) return { ok: false, message: errMessage(error) };
  return {
    ok: true,
    message:
      action === "leave"
        ? "請假成功。退費將於有人遞補後生效,目前狀態:待遞補"
        : "已取消請假,恢復出席",
  };
}

/** 候補報名(guestName 有值 = 幫無帳號朋友登記) */
export async function subSignup(
  sessionId: string,
  guestName?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_sub_signup", {
    p_session_id: sessionId,
    p_guest_name: guestName?.trim() || null,
  });
  revalidatePath("/sub");
  if (error) return { ok: false, message: errMessage(error) };
  return {
    ok: true,
    message: guestName
      ? `已幫 ${guestName} 登記候補`
      : "已登記候補!有人請假時依登記順序自動遞補",
  };
}

/** 取消候補報名(本人或代登者皆可) */
export async function subWithdraw(sessionSubId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_sub_withdraw", {
    p_session_sub_id: sessionSubId,
  });
  revalidatePath("/sub");
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "已取消報名" };
}
