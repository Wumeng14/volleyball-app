"use client";

import { deleteSeason } from "@/app/admin/actions";
import { useTransition } from "react";
import { toast } from "sonner";

/** 刪除季:二次確認防誤觸 */
export function DeleteSeasonButton({
  seasonId,
  seasonName,
}: {
  seasonId: string;
  seasonName: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!window.confirm(`確定要刪除「${seasonName}」嗎?`)) return;
        if (
          !window.confirm(
            `最後確認:刪除「${seasonName}」會一併刪除其所有場次、請假紀錄、候補報名與繳費紀錄,且無法復原。確定刪除?`
          )
        )
          return;
        startTransition(async () => {
          const result = await deleteSeason(seasonId);
          if (result.ok) toast.success(result.message);
          else toast.error(result.message);
        });
      }}
      className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
    >
      {pending ? "刪除中…" : "刪除"}
    </button>
  );
}
