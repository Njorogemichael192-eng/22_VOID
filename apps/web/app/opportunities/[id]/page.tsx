import Link from "next/link";
import { notFound } from "next/navigation";

import { EvidenceCard } from "@/components/evidence-card";
import { StakeCalculator, type CalculatorLeg } from "@/components/stake-calculator";
import { StatusBadge } from "@/components/status-badge";
import { opportunityEvidence, isArbStatus } from "@/lib/dashboard/explain";
import { legRows, compareBookmakerOdds } from "@/lib/dashboard/metrics";
import { formatAge, formatDate, formatMoney, formatOdds, formatRoi } from "@/lib/dashboard/format";
import { serverDashboardRepo } from "@/lib/dashboard/server-repo";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = Date.now();
  const repo = serverDashboardRepo();

  const opp = await repo.getOpportunity(id);
  if (opp === null) notFound();
  const marketPage = await repo.listMarkets({ eventId: opp.event.id, cursor: null, limit: 100 });
  const markets = marketPage.data;
  const rows = legRows(opp);
  const comparisons = compareBookmakerOdds(opp, markets);
  const sections = opportunityEvidence(opp, now);
  const legsForCalculator: CalculatorLeg[] = rows
    .filter((row) => row.stake !== null)
    .map((row) => ({
      bookmaker: row.bookmaker,
      selection: row.selection,
      odds: row.odds,
      stake: row.stake ?? 0,
    }));

  return (
    <div className="space-y-8">
      <p className="text-sm">
        <Link
          href="/opportunities"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Opportunities
        </Link>
      </p>

      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tighter">
            <Link href={`/events/${opp.event.id}`} className="underline-offset-4 hover:underline">
              {opp.event.homeTeam} v {opp.event.awayTeam}
            </Link>
          </h1>
          <StatusBadge value={opp.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {opp.event.competition} · kick-off {formatDate(opp.event.startTime)} ·{" "}
          {opp.marketStructure !== null
            ? opp.marketStructure.replaceAll("_", " ").toLowerCase()
            : "generic structure"}{" "}
          · detected {formatAge(opp.detectedAt, now)}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="guarantee-cards">
        <GuaranteeCard label="Total stake" value={formatMoney(opp.totalStake)} />
        <GuaranteeCard
          label="Minimum return"
          value={formatMoney(opp.minReturn)}
          testId="min-return"
        />
        <GuaranteeCard
          label="Guaranteed profit"
          value={formatMoney(opp.guaranteedProfit)}
          testId="guaranteed-profit"
        />
        <GuaranteeCard
          label="ROI"
          value={formatRoi(opp.roi)}
          accent={opp.guaranteedProfit !== null && opp.guaranteedProfit > 0}
        />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-semibold">Market matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="leg-matrix">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Bookmaker</th>
                <th className="py-2 pr-4 font-medium">Market</th>
                <th className="py-2 pr-4 font-medium">Selection</th>
                <th className="py-2 pr-4 font-medium">Odds</th>
                <th className="py-2 pr-4 font-medium">Stake</th>
                <th className="py-2 pr-4 font-medium">Return</th>
                <th className="py-2 font-medium">Payout</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.selectionId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{row.bookmaker}</td>
                  <td className="py-2 pr-4">{row.market}</td>
                  <td className="py-2 pr-4">{row.selection}</td>
                  <td className="py-2 pr-4">{formatOdds(row.odds)}</td>
                  <td className="py-2 pr-4">{formatMoney(row.stake)}</td>
                  <td className="py-2 pr-4">{formatMoney(row.guaranteedReturn)}</td>
                  <td className="py-2">{row.settlementResult?.replaceAll("_", " ") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {legsForCalculator.length > 0 && <StakeCalculator legs={legsForCalculator} />}
        <div className="rounded-lg border p-4">
          <h2 className="text-sm font-semibold" data-testid="bookmaker-comparison">
            Bookmaker comparison
          </h2>
          {comparisons.map((comparison) => (
            <div key={comparison.marketId} className="mt-3">
              <h3 className="text-sm text-muted-foreground">{comparison.marketLabel}</h3>
              <table className="mt-1 w-full text-left text-sm">
                <tbody>
                  {comparison.outcomes.map((outcome) => (
                    <tr key={outcome.outcome}>
                      <td className="py-1 pr-4">{outcome.selection}</td>
                      {outcome.cells.map((cell) => (
                        <td key={cell.bookmaker} className="py-1 pr-3">
                          <span
                            className={cn(
                              "inline-block rounded px-1.5 py-0.5",
                              cell.best && "bg-emerald-500/10 font-medium text-emerald-700",
                              cell.usedInOpp && "ring-1 ring-inset ring-primary"
                            )}
                            title={
                              cell.usedInOpp ? `Snapshot bookmaker: ${cell.bookmaker}` : undefined
                            }
                          >
                            {cell.bookmaker} {cell.odds !== null ? formatOdds(cell.odds) : "—"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="mt-3 text-xs text-muted-foreground">
            Best current price highlighted; the ring marks the bookmaker the opportunity locked in
            at snapshot time.
          </p>
        </div>
      </section>

      <section className="space-y-4" data-testid="evidence">
        <h2 className="text-lg font-semibold">Why</h2>
        {sections.map((section) => (
          <EvidenceCard key={section.title} section={section} />
        ))}
        {isArbStatus(opp.status) && (
          <p className="text-xs text-muted-foreground" data-testid="engine-versions">
            Engines — optimisation {opp.optimizerVersion ?? "—"} · normalisation{" "}
            {opp.normalizerVersion ?? "—"} · settlement {opp.settlementVersion ?? "—"} · pipeline{" "}
            {opp.engineVersion}
          </p>
        )}
      </section>
    </div>
  );
}

function GuaranteeCard({
  label,
  value,
  testId,
  accent,
}: {
  label: string;
  value: string;
  testId?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        data-testid={testId}
        className={cn("mt-1 text-xl font-semibold", accent ? "text-emerald-700" : undefined)}
      >
        {value}
      </p>
    </div>
  );
}
