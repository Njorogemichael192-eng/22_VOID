import Link from "next/link";
import type { OpportunityView } from "@22void/db";

import { StatusBadge } from "./status-badge";
import { EmptyState } from "./empty-state";
import { formatAge, formatMoney, formatRoi } from "@/lib/dashboard/format";

function legSummary(opp: OpportunityView): string {
  return opp.legs.map((leg) => `${leg.bookmaker} ${leg.oddsSnapshot.toFixed(2)}`).join(" · ");
}

export function OpportunityTable({
  opportunities,
  now,
}: {
  opportunities: OpportunityView[];
  now: number;
}) {
  if (opportunities.length === 0) {
    return <EmptyState title="No opportunities" body="Try clearing the filters." />;
  }
  return (
    <table className="w-full text-left text-sm" data-testid="opportunity-table">
      <thead>
        <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-2 pr-4 font-medium">Event</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Legs</th>
          <th className="py-2 pr-4 font-medium">Total stake</th>
          <th className="py-2 pr-4 font-medium">Guaranteed profit</th>
          <th className="py-2 pr-4 font-medium">ROI</th>
          <th className="py-2 font-medium">Age</th>
        </tr>
      </thead>
      <tbody>
        {opportunities.map((opp) => (
          <tr key={opp.id} className="border-b last:border-0 hover:bg-secondary/40">
            <td className="py-2 pr-4">
              <Link
                href={`/opportunities/${opp.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {opp.event.homeTeam} v {opp.event.awayTeam}
              </Link>
              <div className="text-xs text-muted-foreground">{opp.event.competition}</div>
            </td>
            <td className="py-2 pr-4">
              <StatusBadge value={opp.status} />
            </td>
            <td className="py-2 pr-4 text-xs text-muted-foreground">{legSummary(opp)}</td>
            <td className="py-2 pr-4">{formatMoney(opp.totalStake)}</td>
            <td className="py-2 pr-4">{formatMoney(opp.guaranteedProfit)}</td>
            <td className="py-2 pr-4">{formatRoi(opp.roi)}</td>
            <td className="py-2 text-muted-foreground">{formatAge(opp.detectedAt, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
