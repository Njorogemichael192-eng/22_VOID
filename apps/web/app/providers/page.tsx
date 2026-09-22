import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { serverDashboardRepo } from "@/lib/dashboard/server-repo";
import { summarizeScanner } from "@/lib/dashboard/metrics";
import { formatAge } from "@/lib/dashboard/format";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const now = Date.now();
  const repo = serverDashboardRepo();
  const [providers, runs] = await Promise.all([repo.listProviders(), repo.listScannerRuns(20)]);
  const scanner = summarizeScanner(runs, now);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold tracking-tighter">Providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ingestion health per source and the scanner heartbeat.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
        {providers.map((provider) => (
          <div
            key={provider.key}
            className="rounded-lg border p-4"
            data-testid={`provider-${provider.key}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{provider.displayName}</h2>
              <StatusBadge value={provider.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{provider.key}</p>
            {provider.baseUrl !== null && (
              <p className="mt-1 truncate text-xs text-muted-foreground">{provider.baseUrl}</p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Last seen {provider.lastSeenAt ? formatAge(provider.lastSeenAt, now) : "never"}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold" data-testid="scanner-runs">
          Scanner heartbeat
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {scanner.stale ? (
            <span className="text-red-700">
              Stale — last run {formatAge(scanner.stale.since, now)} for {scanner.stale.sourceKey}.
            </span>
          ) : (
            <span className="text-emerald-700">
              Healthy — the latest run is within the freshness window.
            </span>
          )}
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Started</th>
              <th className="py-2 pr-4 font-medium">Source</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {scanner.runs.map((run) => (
              <tr key={run.runId} className="border-b last:border-0">
                <td className="py-2 pr-4">{formatAge(run.startedAt, now)}</td>
                <td className="py-2 pr-4">{run.sourceKey ?? "full scan"}</td>
                <td className="py-2 pr-4">
                  <StatusBadge value={run.status} />
                </td>
                <td className="py-2 text-muted-foreground">{run.message ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          <Link href="/events" className="underline-offset-4 hover:underline">
            Browse events →
          </Link>
        </p>
      </section>
    </div>
  );
}
