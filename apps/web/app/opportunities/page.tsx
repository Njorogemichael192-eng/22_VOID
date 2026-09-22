import { OPPORTUNITY_STATUS_VALUES } from "@22void/domain";

import { OpportunityFilters } from "@/components/opportunity-filters";
import { OpportunityTable } from "@/components/opportunity-table";
import { serverDashboardRepo } from "@/lib/dashboard/server-repo";

export const dynamic = "force-dynamic";

function validStatus(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return OPPORTUNITY_STATUS_VALUES.includes(value as never) ? value : undefined;
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const status = validStatus(params.status);
  const limitValue = Number(params.limit);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 200) : 50;
  const now = Date.now();

  const repo = serverDashboardRepo();
  const page = await repo.listOpportunities({ status, cursor: null, limit });

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tighter">Opportunities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every row was proven against the outcome-state model before it was allowed to exist.
          </p>
        </div>
        <OpportunityFilters />
      </section>

      <div className="rounded-lg border p-4">
        <OpportunityTable opportunities={page.data} now={now} />
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {page.data.length} of {limit > 0 ? `${limit}+` : "?"} requested ·{" "}
        {status !== undefined ? `filtered by ${status.replaceAll("_", " ")}` : "all statuses"}
      </p>
    </div>
  );
}
