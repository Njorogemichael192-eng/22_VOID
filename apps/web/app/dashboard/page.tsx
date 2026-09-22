import Link from "next/link";

import { getDashboardSnapshot } from "@/lib/dashboard/snapshot";
import { serverDashboardRepo } from "@/lib/dashboard/server-repo";
import { OpportunityTable } from "@/components/opportunity-table";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { formatAge, formatTime } from "@/lib/dashboard/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const repo = serverDashboardRepo();
  const snapshot = await getDashboardSnapshot(repo);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold tracking-tighter">
          <span className="text-primary">22</span>
          <span className="text-muted-foreground">_VOID</span> live dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Verified opportunities, provider health and scanner heartbeat.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live opportunities</h2>
            <Link
              href="/opportunities"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="rounded-lg border p-4">
            {snapshot.verified.length > 0 ? (
              <OpportunityTable opportunities={snapshot.verified} now={snapshot.generatedAt} />
            ) : (
              <EmptyState
                title="No verified opportunities"
                body="Re-check when live prices produce a positive minimum return."
              />
            )}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold" data-testid="provider-health">
              Provider health
            </h2>
            <ul className="mt-3 space-y-2">
              {snapshot.providers.map((provider) => (
                <li key={provider.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{provider.displayName}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {provider.lastSeenAt
                      ? formatAge(provider.lastSeenAt, snapshot.generatedAt)
                      : "never"}
                    <StatusBadge value={provider.status} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold" data-testid="scanner-heartbeat">
              Scanner heartbeat
            </h2>
            {snapshot.scanner.stale ? (
              <p className="mt-2 text-sm text-red-700">
                Stale — last run {formatAge(snapshot.scanner.stale.since, snapshot.generatedAt)} for{" "}
                {snapshot.scanner.stale.sourceKey}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-emerald-700">
                Healthy — last full scan {formatTime(snapshot.scanner.lastRunAt ?? "")}.
              </p>
            )}
            <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <dt>Status</dt>
                <dd>
                  <StatusBadge value={snapshot.scanner.status} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Running runs</dt>
                <dd>{snapshot.scanner.runningRuns}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Last run</dt>
                <dd>
                  {snapshot.scanner.lastRunAt
                    ? formatAge(snapshot.scanner.lastRunAt, snapshot.generatedAt)
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}
