"use client";

import { useMemo, useState } from "react";

import { CURRENCY, formatMoney, formatOdds, formatRoi } from "@/lib/dashboard/format";

export interface CalculatorLeg {
  bookmaker: string;
  selection: string;
  odds: number;
  stake: number;
}

export function StakeCalculator({ legs }: { legs: CalculatorLeg[] }) {
  const initial = useMemo(
    () => legs.reduce((sum, leg) => sum + (Number.isFinite(leg.stake) ? leg.stake : 0), 0),
    [legs]
  );
  const [budget, setBudget] = useState<number>(initial > 0 ? initial : 100);

  const plan = useMemo(() => {
    const total = legs.reduce((sum, leg) => sum + Math.max(0, leg.stake), 0);
    const rows = legs.map((leg) => {
      const share = total > 0 ? leg.stake / total : 1 / legs.length;
      const stake = budget * share;
      return { leg, share, stake, ret: stake * leg.odds };
    });
    const minReturn = Math.min(...rows.map((row) => row.ret));
    const profit = minReturn - budget;
    return { rows, minReturn, profit, roi: budget > 0 ? profit / budget : 0 };
  }, [legs, budget]);

  return (
    <div className="rounded-lg border p-4" data-testid="stake-calculator">
      <label className="text-sm font-semibold">Stake calculator</label>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{CURRENCY}</span>
        <input
          type="number"
          min={1}
          step={1}
          value={budget}
          onChange={(event) => setBudget(Number(event.target.value))}
          className="w-32 rounded-md border bg-background px-2 py-1 text-sm"
        />
        <span className="text-xs text-muted-foreground">
          Plan scales proportionally — the optimizer split is preserved.
        </span>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        {plan.rows.map((row) => (
          <div key={row.leg.bookmaker + row.leg.selection} className="flex justify-between">
            <span>
              {row.leg.bookmaker} — {row.leg.selection} at {formatOdds(row.leg.odds)}
            </span>
            <span className="text-muted-foreground">
              {formatMoney(row.stake)} → {formatMoney(row.ret)}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 font-medium">
          <span>Total staked</span>
          <span>{formatMoney(budget)}</span>
        </div>
        <div className="flex justify-between">
          <span>Worst-case return</span>
          <span data-testid="calc-min-return">{formatMoney(plan.minReturn)}</span>
        </div>
        <div className="flex justify-between">
          <span>Guaranteed profit</span>
          <span data-testid="calc-profit">{formatMoney(plan.profit)}</span>
        </div>
        <div className="flex justify-between">
          <span>ROI</span>
          <span data-testid="calc-roi">{formatRoi(plan.roi)}</span>
        </div>
      </div>
    </div>
  );
}
