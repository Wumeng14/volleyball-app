"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

/** 遞補報名 */
export async function subSignup(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_sub_signup", {
    p_session_id: sessionId,
  });
  revalidatePath("/sub");
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "報名成功!" };
}

/** 遞補取消報名 */
export async function subWithdraw(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_sub_withdraw", {
    p_session_id: sessionId,
  });
  revalidatePath("/sub");
  if (error) return { ok: false, message: errMessage(error) };
  return { ok: true, message: "已取消報名" };
}
