import { Card } from "@/components/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6">
      <div className="text-center">
        <div className="text-5xl">🏐</div>
        <h1 className="mt-3 text-2xl font-bold">排球季打管理</h1>
        <p className="mt-1 text-sm text-zinc-500">
          請假、遞補、帳務,一個連結搞定
        </p>
      </div>

      {params.error && (
        <Card className="border-rose-200 bg-rose-50 text-sm text-rose-700">
          {params.error}
        </Card>
      )}

      <a
        href={`/auth/line/login?next=${encodeURIComponent(next)}`}
        className="inline-flex items-center gap-2 rounded-lg bg-[#06C755] px-6 py-3 font-medium text-white hover:bg-[#05b34c]"
      >
        使用 LINE 登入
      </a>

      <p className="max-w-xs text-center text-xs text-zinc-400">
        首次登入會自動建立帳號,不需要密碼。
      </p>
    </div>
  );
}
