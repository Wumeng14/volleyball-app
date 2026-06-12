"use client";

import { Button } from "@/components/ui";
import { useRef, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

type ActionResult = { ok: boolean; message: string };

/** 包 server action 的表單:送出 → toast 回饋 → 成功時清空 */
export function ActionForm({
  action,
  children,
  submitLabel,
  confirmText,
  className,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children?: ReactNode;
  submitLabel: string;
  confirmText?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          try {
            const result = await action(formData);
            if (result.ok) {
              toast.success(result.message);
              formRef.current?.reset();
            } else {
              toast.error(result.message);
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "操作失敗");
          }
        });
      }}
    >
      {children}
      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "處理中…" : submitLabel}
      </Button>
    </form>
  );
}

/** 單鍵 server action 按鈕(取消場次、標記退出等) */
export function ActionButton({
  action,
  label,
  confirmText,
  variant = "secondary",
}: {
  action: () => Promise<ActionResult>;
  label: string;
  confirmText?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        startTransition(async () => {
          try {
            const result = await action();
            if (result.ok) toast.success(result.message);
            else toast.error(result.message);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "操作失敗");
          }
        });
      }}
    >
      {pending ? "…" : label}
    </Button>
  );
}
