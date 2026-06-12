"use client";

import { toggleLeave } from "@/app/actions";
import { Button } from "@/components/ui";
import { useTransition } from "react";
import { toast } from "sonner";

/**
 * 請假 ↔ 取消請假 toggle。
 * 操作路徑:點按鈕 → confirm 一次 → 完成(≤ 3 步驗收)。
 */
export function LeaveToggle({
  sessionId,
  status,
  deadlinePassed,
}: {
  sessionId: string;
  status: string;
  deadlinePassed: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (deadlinePassed) {
    return (
      <Button variant="secondary" disabled>
        已截止
      </Button>
    );
  }

  const isLeave = status === "attend";
  const action = isLeave ? "leave" : "leave_cancel";
  const label = isLeave ? "請假" : "取消請假";
  const confirmText = isLeave
    ? "確定要請假嗎?退費將於有人遞補後生效。"
    : "確定取消請假、恢復出席嗎?";

  return (
    <Button
      variant={isLeave ? "secondary" : "primary"}
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        startTransition(async () => {
          const result = await toggleLeave(sessionId, action);
          if (result.ok) toast.success(result.message);
          else toast.error(result.message);
        });
      }}
    >
      {pending ? "處理中…" : label}
    </Button>
  );
}
