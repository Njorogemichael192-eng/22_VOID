import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { serverDashboardRepo } from "@/lib/dashboard/server-repo";
import { formatDate, formatOdds, marketLabel, periodLabel } from "@/lib/dashboard/format";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = serverDashboardRepo();

  const event = await repo.getEvent(id);
  if (event === null) notFound();
  const marketPage = await repo.listMarkets({ eventId: event.id, cursor: null, limit: 100 });
  const markets = marketPage.data;

  return (
    <div className="space-y-8">
      <p className="text-sm">
        <Link href="/events" className="text-muted-foreground underline-offset-4 hover:underline">
          ← Events
        </Link>
      </p>

      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tighter">
            {event.homeTeam} v {event.awayTeam}
          </h1>
          <StatusBadge value={event.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {event.competition} · {event.sport} · kick-off {formatDate(event.startTime)}
        </p>
        {event.sourceLinks.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="source-links">
            Sources:{" "}
            {event.sourceLinks.map((link) => `${link.sourceKey}#${link.sourceEventId}`).join(", ")}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold" data-testid="market-matrix">
          Market matrix
        </h2>
        {markets.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {markets.map((market) => (
              <div key={market.id} className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold">
                  {marketLabel(market)}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({periodLabel(market.period)})
                  </span>
                </h3>
                {market.odds.length > 0 ? (
                  <table className="mt-2 w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-1 pr-4 font-medium">Selection</th>
                        <th className="py-1 pr-4 font-medium">Bookmaker</th>
                        <th className="py-1 font-medium">Odds</th>
                      </tr>
                    </thead>
                    <tbody>
                      {market.odds.map((odds) => (
                        <tr key={odds.id} className="border-b last:border-0">
                          <td className="py-1 pr-4">{odds.outcome.replaceAll("_", " ")}</td>
                          <td className="py-1 pr-4">{odds.bookmaker}</td>
                          <td className="py-1">{formatOdds(odds.odds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No current prices.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No markets"
            body="Prices have not been collected for this event yet."
          />
        )}
      </section>
    </div>
  );
}
