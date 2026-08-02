import * as React from "react";
import { cn } from "@/lib/utils";
import type { ServerStatus } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-grass-500 text-ink-950 hover:bg-grass-400 focus-visible:outline-grass-400 font-semibold shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset]",
  secondary: "bg-ink-700 text-ink-100 hover:bg-ink-600 focus-visible:outline-ink-500",
  ghost: "bg-transparent text-ink-300 hover:bg-ink-800 hover:text-ink-100",
  danger: "bg-red-500/90 text-white hover:bg-red-500 focus-visible:outline-red-400",
  outline:
    "border border-ink-600 bg-transparent text-ink-200 hover:border-ink-500 hover:bg-ink-800",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 ",
  md: "h-10 px-4 text-sm gap-2 ",
  lg: "h-12 px-6 text-base gap-2.5 ",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
  className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-colors",
        "font-mono uppercase tracking-wider",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        buttonSizes[size],
        buttonVariants[variant],
  className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
  className={cn(
        " border border-ink-700/70 bg-ink-900/70 backdrop-blur",
  className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
  className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-ink-700/70 px-5 py-4",
  className,
      )}
    >
      <div className="min-w-0">
        <h2 className="font-sans text-[15px] font-extrabold tracking-[-.02em] text-ink-100">
          {title}
        </h2>
        {description && (
          <p className="mt-1 font-mono text-[11px] text-ink-400">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "grass" | "amber" | "red" | "blue" | "violet";
  className?: string;
}) {
  const tones = {
    neutral: "bg-ink-700/70 text-ink-300 border-ink-600",
    grass: "bg-grass-500/12 text-grass-300 border-grass-500/30",
    amber: "bg-amber-500/12 text-amber-300 border-amber-500/30",
    red: "bg-red-500/12 text-red-300 border-red-500/30",
    blue: "bg-sky-500/12 text-sky-300 border-sky-500/30",
    violet: "bg-violet-500/12 text-violet-300 border-violet-500/30",
  };
  return (
    <span
  className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
  className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

const fieldBase =
  "w-full  border border-ink-600 bg-ink-850 px-3 py-2 text-sm text-ink-100 " +
  "placeholder:text-ink-500 transition-colors focus:border-grass-500 focus:outline-none " +
  "focus:ring-2 focus:ring-grass-500/25 disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, "h-10", className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, className)} {...props} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-300">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
  className="flex w-full items-center justify-between gap-4 border border-ink-700 bg-ink-850/60 px-4 py-3 text-left transition-colors hover:border-ink-600 disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-sm text-ink-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-400">{description}</span>}
      </span>
      <span
  className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-grass-500" : "bg-ink-600",
        )}
      >
        <span
  className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export const STATUS_META: Record<
  ServerStatus,
  { label: string; dot: string; text: string; ring: string }
> = {
  online: {
    label: "Online",
    dot: "bg-grass-400",
    text: "text-grass-300",
    ring: "bg-grass-500/10 border-grass-500/30",
  },
  offline: {
    label: "Offline",
    dot: "bg-ink-500",
    text: "text-ink-400",
    ring: "bg-ink-700/60 border-ink-600",
  },
  queued: {
    label: "In queue",
    dot: "bg-violet-400",
    text: "text-violet-300",
    ring: "bg-violet-500/10 border-violet-500/30",
  },
  preparing: {
    label: "Preparing",
    dot: "bg-sky-400",
    text: "text-sky-300",
    ring: "bg-sky-500/10 border-sky-500/30",
  },
  starting: {
    label: "Starting",
    dot: "bg-amber-400",
    text: "text-amber-300",
    ring: "bg-amber-500/10 border-amber-500/30",
  },
  stopping: {
    label: "Stopping",
    dot: "bg-amber-400",
    text: "text-amber-300",
    ring: "bg-amber-500/10 border-amber-500/30",
  },
  crashed: {
    label: "Crashed",
    dot: "bg-red-400",
    text: "text-red-300",
    ring: "bg-red-500/10 border-red-500/30",
  },
};

export function StatusPill({
  status,
  detail,
  className,
}: {
  status: ServerStatus;
  detail?: string | null;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  const busy = status !== "online" && status !== "offline" && status !== "crashed";
  return (
    <span
  className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
        meta.ring,
        meta.text,
  className,
      )}
    >
      <span
  className={cn("size-1.5 rounded-full", meta.dot, busy && "animate-pulse-dot")}
      />
      {detail ?? meta.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-ink-700 bg-ink-900/40 px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ink-500">{icon}</div>}
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    error: "border-red-500/30 bg-red-500/10 text-red-200",
    success: "border-grass-500/30 bg-grass-500/10 text-grass-200",
  };
  return (
    <div className={cn(" border px-4 py-3 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-1", "text-[13px] opacity-90")}>{children}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="border border-ink-700/70 bg-ink-850/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
    </div>
  );
}
