"use client";

import { subSignup, subWithdraw } from "@/app/actions";
import { Button } from "@/components/ui";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/** 本人候補報名按鈕 */
export function SubSignupButton({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() => {
        if (!window.confirm("確定登記候補嗎?排上後單場費於現場或轉帳繳交。"))
          return;
        startTransition(async () => {
          const result = await subSignup(sessionId);
          if (result.ok) toast.success(result.message);
          else toast.error(result.message);
        });
      }}
    >
      {pending ? "處理中…" : "登記候補"}
    </Button>
  );
}

/** 幫無帳號朋友登記(臨打) */
export function GuestSignupForm({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        startTransition(async () => {
          const result = await subSignup(sessionId, name);
          if (result.ok) {
            toast.success(result.message);
            setName("");
          } else {
            toast.error(result.message);
          }
        });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="朋友姓名(無帳號臨打)"
        className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
      />
      <Button type="submit" variant="secondary" disabled={pending || !name.trim()}>
        {pending ? "…" : "代登"}
      </Button>
    </form>
  );
}

/** 取消報名(本人或代登者) */
export function CancelEntryButton({
  sessionSubId,
  label,
}: {
  sessionSubId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`確定取消「${label}」的候補報名嗎?`)) return;
        startTransition(async () => {
          const result = await subWithdraw(sessionSubId);
          if (result.ok) toast.success(result.message);
          else toast.error(result.message);
        });
      }}
    >
      {pending ? "…" : "取消"}
    </Button>
  );
}
