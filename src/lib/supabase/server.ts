import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server Component / Server Action / Route Handler 用的 Supabase client(帶使用者 session) */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component 內呼叫 set 會丟錯,可安全忽略(middleware 會刷新)
          }
        },
      },
    }
  );
}
