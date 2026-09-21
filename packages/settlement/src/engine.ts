/**
 * Versioned settlement rules and the settlement engine (§15, §53, Rule 2).
 *
 * Settlement rules are versioned per provider with an effective window; the
 * engine resolves the rule applicable at a given instant and delegates to it.
 * When no rule applies (or the rule cannot settle the selection) the engine
 * returns `kind: "unknown"` — see the domain's UNKNOWN_SETTLEMENT reason. Rules
 * always come from the source, never from the market name (Rule 2), and a
 * newer rule is never applied to historical data silently (§53).
 */

import { settleSelection } from "./settle";
import type { MatchState, SettleAssessment, SettleableSelection } from "./settle";

export interface SettlementRule {
  readonly provider: string;
  readonly ruleVersion: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly sourceReference?: string;
  settle(selection: SettleableSelection, match: MatchState): ReturnType<typeof settleSelection>;
}

export type SettleVerdict =
  | {
      kind: "settled";
      rule: { provider: string; ruleVersion: string; sourceReference?: string };
      assessment: SettleAssessment;
    }
  | { kind: "unknown"; reason: string; rule?: { provider: string; ruleVersion: string } };

export class SettlementRuleStore {
  private readonly rules: SettlementRule[] = [];

  register(rule: SettlementRule): void {
    if (
      this.rules.some((r) => r.provider === rule.provider && r.ruleVersion === rule.ruleVersion)
    ) {
      throw new Error(`settlement rule ${rule.provider}#${rule.ruleVersion} already registered`);
    }
    this.rules.push(rule);
  }

  /** Rule for a provider active at instant `at` (defaults to now). */
  ruleFor(provider: string, at: number = Date.now()): SettlementRule | undefined {
    const candidates = this.rules
      .filter((rule) => {
        if (rule.provider !== provider) return false;
        const from = rule.effectiveFrom === undefined ? -Infinity : Date.parse(rule.effectiveFrom);
        const to = rule.effectiveTo === undefined ? Infinity : Date.parse(rule.effectiveTo);
        return at >= from && at < to;
      })
      .sort((a, b) => {
        const aFrom = a.effectiveFrom === undefined ? 0 : Date.parse(a.effectiveFrom);
        const bFrom = b.effectiveFrom === undefined ? 0 : Date.parse(b.effectiveFrom);
        return bFrom - aFrom;
      });
    return candidates[0];
  }

  providers(): string[] {
    return [...new Set(this.rules.map((rule) => rule.provider))];
  }
}

/** The reference ruleset implementing spec §9–§16. */
export function standardSettlementRule(
  provider = "std",
  ruleVersion = "1",
  sourceReference = "ARBITRAGE_ENGINE_SPEC §9–§16"
): SettlementRule {
  return {
    provider,
    ruleVersion,
    sourceReference,
    settle: settleSelection,
  };
}

export interface SettlementEngineOptions {
  /** Default rule set already registered; pass false to start empty. */
  seedStandard?: boolean;
}

export class SettlementEngine {
  readonly store: SettlementRuleStore;
  private readonly seedStandard: boolean;

  constructor(store?: SettlementRuleStore, options: SettlementEngineOptions = {}) {
    this.store = store ?? new SettlementRuleStore();
    this.seedStandard = options.seedStandard ?? true;
    if (this.seedStandard && (store === undefined || store.ruleFor("std") === undefined)) {
      this.store.register(standardSettlementRule());
    }
  }

  settle(
    provider: string,
    selection: SettleableSelection,
    match: MatchState,
    at?: number
  ): SettleVerdict {
    const rule = this.store.ruleFor(provider, at ?? Date.now());
    if (rule === undefined) {
      return {
        kind: "unknown",
        reason: `UNKNOWN_SETTLEMENT: no applicable rule for provider "${provider}"`,
      };
    }
    const core = rule.settle(selection, match);
    if (core.kind === "unknown") {
      return {
        kind: "unknown",
        reason: core.reason,
        rule: { provider: rule.provider, ruleVersion: rule.ruleVersion },
      };
    }
    return {
      kind: "settled",
      rule: {
        provider: rule.provider,
        ruleVersion: rule.ruleVersion,
        ...(rule.sourceReference !== undefined ? { sourceReference: rule.sourceReference } : {}),
      },
      assessment: core.assessment,
    };
  }
}
