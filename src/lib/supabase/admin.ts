import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client(僅限伺服器端使用,繞過 RLS)。
 * 只用於 LINE 登入時的使用者建立/換發 session,以及管理員代登無帳號臨打。
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
