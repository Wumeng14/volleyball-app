"use client";

import { useFormStatus } from "react-dom";

/** Server action 表單的送出鈕:送出期間 disabled,防止連點重複建立 */
export function SubmitButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        className ??
        "w-full rounded-lg bg-emerald-600 py-3 font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
      }
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
