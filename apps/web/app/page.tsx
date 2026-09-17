import { MarketFamily, Period, SettlementResult } from "@22void/domain";
import { MIN_DECIMAL_ODDS } from "@22void/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PIPELINE = [
  "DATA",
  "VALIDATION",
  "EVENT NORMALIZATION",
  "MARKET NORMALIZATION",
  "SETTLEMENT",
  "OUTCOME STATES",
  "COVERAGE ANALYSIS",
  "STAKE OPTIMIZATION",
  "MINIMUM RETURN",
  "FRESHNESS",
  "VERIFIED OPPORTUNITY",
] as const;

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <section className="space-y-4 text-center">
        <Badge variant="outline">Phase 0 — Foundation</Badge>
        <h1 className="text-5xl font-bold tracking-tighter">
          <span className="text-primary">22</span>
          <span className="text-muted-foreground">_VOID</span>
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Cloud-hosted, football-first sports-arbitrage research platform. No
          opportunity is presented unless every possible settlement state is
          covered and the worst-case return is proven positive.
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" asChild>
            <a href="#pipeline">Pipeline</a>
          </Button>
        </div>
      </section>

      <section id="pipeline" className="w-full max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>Detection pipeline</CardTitle>
            <CardDescription>
              The authoritative arb test is the payoff/state model — never
              reciprocal sums alone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {PIPELINE.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <footer className="text-xs text-muted-foreground">
        Canonical seed: {MarketFamily.ASIAN_TOTAL} · {Period.FULL_MATCH} ·{" "}
        {SettlementResult.HALF_WIN} · minimum odds {MIN_DECIMAL_ODDS}
        <br />
        Architectural documents: PROJECT_STATE.md · TECH_STACK.md ·
        BUILD_AGENT_PROMPT.md · docs/ARBITRAGE_ENGINE_SPEC.md
      </footer>
    </main>
  );
}