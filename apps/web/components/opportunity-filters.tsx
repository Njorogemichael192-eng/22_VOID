"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { OPPORTUNITY_STATUS_VALUES } from "@22void/domain";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...OPPORTUNITY_STATUS_VALUES.map((value) => ({
    value,
    label: value.replaceAll("_", " "),
  })),
];

export function OpportunityFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const active = searchParams.get("status") ?? "";

  function apply(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next === "") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    startTransition(() => {
      router.replace(`/opportunities${params.size > 0 ? `?${params.toString()}` : ""}`);
    });
  }

  return (
    <div className="flex items-center gap-2" data-testid="opportunity-filters">
      <label htmlFor="status-filter" className="text-sm text-muted-foreground">
        Status
      </label>
      <select
        id="status-filter"
        value={active}
        onChange={(event) => apply(event.target.value)}
        disabled={isPending}
        className="rounded-md border bg-background px-2 py-1 text-sm"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isPending && <span className="text-xs text-muted-foreground">Updating…</span>}
    </div>
  );
}
