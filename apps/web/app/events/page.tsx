import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { serverDashboardRepo } from "@/lib/dashboard/server-repo";
import { formatDate } from "@/lib/dashboard/format";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const repo = serverDashboardRepo();
  const page = await repo.listEvents({ cursor: null, limit: 100 });
  const events = page.data;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tighter">Events</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Canonical events with their market matrix and source links.
        </p>
      </section>

      <div className="rounded-lg border p-4">
        {events.length > 0 ? (
          <table className="w-full text-left text-sm" data-testid="event-table">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Fixture</th>
                <th className="py-2 pr-4 font-medium">Competition</th>
                <th className="py-2 pr-4 font-medium">Kick-off</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Sources</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/events/${event.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {event.homeTeam} v {event.awayTeam}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{event.competition}</td>
                  <td className="py-2 pr-4">{formatDate(event.startTime)}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge value={event.status} />
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {event.sourceLinks.map((link) => link.sourceKey).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No events" body="Events appear once providers register a fixture." />
        )}
      </div>
    </div>
  );
}
