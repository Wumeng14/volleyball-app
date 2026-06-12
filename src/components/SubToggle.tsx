"use client";

import { subSignup, subWithdraw } from "@/app/actions";
import { Button } from "@/components/ui";
import { useTransition } from "react";
import { toast } from "sonner";

export function SubToggle({
  sessionId,
  signedUp,
  full,
}: {
  sessionId: string;
  signedUp: boolean;
  full: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (!signedUp && full) {
    return (
      <Button variant="secondary" disabled>
        已滿
      </Button>
    );
  }

  return (
    <Button
      variant={signedUp ? "secondary" : "primary"}
      disabled={pending}
      onClick={() => {
        const confirmText = signedUp
          ? "確定取消這場的遞補報名嗎?"
          : "確定報名遞補這場嗎?單場費於現場或轉帳繳交。";
        if (!window.confirm(confirmText)) return;
        startTransition(async () => {
          const result = signedUp
            ? await subWithdraw(sessionId)
            : await subSignup(sessionId);
          if (result.ok) toast.success(result.message);
          else toast.error(result.message);
        });
      }}
    >
      {pending ? "處理中…" : signedUp ? "取消報名" : "報名遞補"}
    </Button>
  );
}
