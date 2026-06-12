import { Badge, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const SEASON_STATUS: Record<string, { label: string; tone: "green" | "gray" | "blue" }> = {
  draft: { label: "草稿", tone: "gray" },
  active: { label: "進行中", tone: "green" },
  settled: { label: "已結算", tone: "blue" },
};

export default async function SeasonsPage() {
  const supabase = await createClient();
  const { data: seasons } = await supabase
    .from("seasons")
    .select("*")
    .order("start_date", { ascending: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">季管理</h1>
        <Link
          href="/admin/seasons/new"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + 建立季
        </Link>
      </div>

      {(!seasons || seasons.length === 0) && (
        <Card className="text-zinc-500">還沒有季,點「建立季」開始。</Card>
      )}

      <div className="space-y-2">
        {seasons?.map((s) => {
          const st = SEASON_STATUS[s.status] ?? SEASON_STATUS.draft;
          return (
            <Link key={s.id} href={`/admin/seasons/${s.id}`} className="block">
              <Card className="flex items-center justify-between hover:border-emerald-300">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-zinc-500">
                    {s.start_date} ~ {s.end_date}
                  </p>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
