import { type ReactNode, type ButtonHTMLAttributes } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary:
    "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-300 disabled:text-zinc-500",
  secondary:
    "bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 disabled:text-zinc-400",
  danger:
    "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-zinc-300 disabled:text-zinc-500",
  line: "bg-[#06C755] text-white hover:bg-[#05b34c]",
} as const;

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        buttonVariants[variant],
        className
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

const badgeTones = {
  green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
  gray: "bg-zinc-100 text-zinc-600",
  blue: "bg-sky-100 text-sky-800",
} as const;

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        badgeTones[tone]
      )}
    >
      {children}
    </span>
  );
}

/** 成員場次狀態 → 顯示文字與顏色 */
export const MEMBER_STATUS: Record<string, { label: string; tone: keyof typeof badgeTones }> = {
  attend: { label: "出席", tone: "green" },
  leave_matched: { label: "已遞補(退費)", tone: "blue" },
  leave_pending: { label: "待遞補", tone: "yellow" },
  leave_late: { label: "逾期請假", tone: "red" },
  session_cancelled: { label: "場次取消(退費)", tone: "gray" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = MEMBER_STATUS[status] ?? { label: status, tone: "gray" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
