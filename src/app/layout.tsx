import type { Metadata } from "next";
import { Toaster } from "sonner";
import Link from "next/link";
import { cookies } from "next/headers";
import { toggleViewAsMember } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "排球季打管理",
  description: "排球隊季打出席、請假、遞補與帳務管理",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  let displayName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = profile?.role === "admin";
    displayName = profile?.display_name ?? null;
  }

  const cookieStore = await cookies();
  const viewAsMember = isAdmin && cookieStore.get("view_as_member")?.value === "1";

  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        {user && (
          <nav className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
            <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-3 text-sm">
              <Link href="/" className="font-semibold text-emerald-700">
                🏐 季打
              </Link>
              <Link href="/me" className="text-zinc-600 hover:text-zinc-900">
                我的紀錄
              </Link>
              <Link href="/sub" className="text-zinc-600 hover:text-zinc-900">
                候補
              </Link>
              {isAdmin && !viewAsMember && (
                <Link
                  href="/admin/seasons"
                  className="text-zinc-600 hover:text-zinc-900"
                >
                  管理
                </Link>
              )}
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden text-zinc-500 sm:inline">
                  {displayName}
                </span>
                {isAdmin && !viewAsMember && (
                  <form action={toggleViewAsMember}>
                    <button className="text-zinc-400 hover:text-zinc-600">
                      成員視角
                    </button>
                  </form>
                )}
                <form action="/auth/signout" method="post">
                  <button className="text-zinc-400 hover:text-zinc-600">
                    登出
                  </button>
                </form>
              </div>
            </div>
            {viewAsMember && (
              <div className="bg-amber-100 text-amber-900">
                <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-1.5 text-xs">
                  <span>目前以「一般成員視角」瀏覽,管理功能已隱藏</span>
                  <form action={toggleViewAsMember}>
                    <button className="font-medium underline">
                      切回管理員
                    </button>
                  </form>
                </div>
              </div>
            )}
          </nav>
        )}
        <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
