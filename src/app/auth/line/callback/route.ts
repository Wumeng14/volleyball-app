import { exchangeLineCode, fetchLineProfile } from "@/lib/line";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * LINE Login callback:
 * 1. 驗證 state、以 code 換 access token、取得 LINE profile
 * 2. 以 line_user_id 找或建 Supabase 使用者(email 別名,無密碼)
 * 3. service role 產生 magiclink token → verifyOtp 換成本人 session cookie
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("line_oauth_state")?.value;
  const next = cookieStore.get("line_oauth_next")?.value ?? "/";
  cookieStore.delete("line_oauth_state");
  cookieStore.delete("line_oauth_next");

  const fail = (reason: string) =>
    NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(reason)}`, process.env.NEXT_PUBLIC_APP_URL)
    );

  if (!code || !state || state !== savedState) {
    return fail("LINE 登入驗證失敗,請重試");
  }

  try {
    const tokens = await exchangeLineCode(code);
    const lineProfile = await fetchLineProfile(tokens.access_token);

    const admin = createAdminClient();
    const email = `line_${lineProfile.userId.toLowerCase()}@line.local`;

    // 找或建使用者
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("line_user_id", lineProfile.userId)
      .maybeSingle();

    let userId = existing?.id as string | undefined;
    if (!userId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { line_user_id: lineProfile.userId },
      });
      if (createErr) throw createErr;
      userId = created.user.id;
    }

    // 同步 profile(名稱/頭像以 LINE 最新為準)
    const { error: upsertErr } = await admin.from("profiles").upsert({
      id: userId,
      line_user_id: lineProfile.userId,
      display_name: lineProfile.displayName,
      avatar_url: lineProfile.pictureUrl ?? null,
    });
    if (upsertErr) throw upsertErr;

    // 換發 session:magiclink token_hash → verifyOtp 寫入 cookie
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) throw linkErr;

    const supabase = await createClient();
    const { error: otpErr } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    });
    if (otpErr) throw otpErr;

    return NextResponse.redirect(new URL(next, process.env.NEXT_PUBLIC_APP_URL));
  } catch (e) {
    console.error("LINE login error:", e);
    return fail("登入失敗,請稍後再試");
  }
}
