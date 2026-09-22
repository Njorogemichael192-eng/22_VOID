import type { ExplanationSection } from "@/lib/dashboard/explain";

const TONE_ICON: Record<ExplanationSection["tone"], string> = {
  positive: "✓",
  neutral: "·",
  negative: "✕",
};

export function EvidenceCard({ section }: { section: ExplanationSection }) {
  return (
    <article className="rounded-lg border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span
          data-tone={section.tone}
          className={[
            "inline-flex size-5 items-center justify-center rounded-full text-xs",
            section.tone === "positive" && "bg-emerald-500/15 text-emerald-700",
            section.tone === "neutral" && "bg-slate-500/15 text-slate-700",
            section.tone === "negative" && "bg-red-500/15 text-red-700",
          ].join(" ")}
        >
          {TONE_ICON[section.tone]}
        </span>
        {section.title}
      </h3>
      <p
        data-testid={`evidence-${section.title.replaceAll(" ", "-").toLowerCase()}`}
        className="mt-2 text-sm"
      >
        {section.summary}
      </p>
      {section.points.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {section.points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
