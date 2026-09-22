import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  VERIFIED_ARB: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  FRESH_ARB: "border-sky-600/40 bg-sky-500/10 text-sky-700",
  THEORETICAL_ARB: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  DETECTED: "border-slate-600/40 bg-slate-500/10 text-slate-700",
  VALIDATING: "border-slate-600/40 bg-slate-500/10 text-slate-700",
  STALE: "border-orange-600/40 bg-orange-500/10 text-orange-700",
  INVALIDATED: "border-red-600/40 bg-red-500/10 text-red-700",
  REJECTED: "border-red-600/40 bg-red-500/10 text-red-700",
  HEALTHY: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  DEGRADED: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  DOWN: "border-red-600/40 bg-red-500/10 text-red-700",
  UNKNOWN: "border-slate-600/40 bg-slate-500/10 text-slate-700",
  OPEN: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  CLOSED: "border-slate-600/40 bg-slate-500/10 text-slate-700",
};

function toneFor(value: string): string {
  return TONES[value] ?? "border-slate-600/40 bg-slate-500/10 text-slate-700";
}

export function StatusBadge({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-badge={value}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        toneFor(value),
        className
      )}
    >
      {label ?? value.replaceAll("_", " ")}
    </span>
  );
}
