import type { MarketFamily, Participant, Period } from "@22void/domain";

/**
 * Golden market-normalization cases (Phase 17 regression fixtures).
 *
 * Pins the label-classifier and key-registry behaviour of the Phase 5 market
 * normalizer (spec §7, Rule 2): equivalent descriptors normalize identically,
 * non-equivalent markets never interchange, and anything unverifiable is
 * rejected with a reason — never guessed.
 */

export interface NormalizationOutcomeInput {
  name: string;
  point?: string;
}

export interface MarketNormalizationCase {
  id: string;
  label?: string;
  key: string;
  outcomes?: readonly NormalizationOutcomeInput[];
  expected: {
    matched: boolean;
    reasonContains?: string;
    family?: MarketFamily;
    period?: Period;
    marketType?: string;
    participant?: Participant;
    line?: string;
    via?: "key" | "label";
  };
}

export const marketNormalizationCases: MarketNormalizationCase[] = [
  {
    id: "norm-goals-over-under-line",
    label: "Goals Over/Under 2.5",
    key: "totals",
    expected: {
      matched: true,
      family: "MATCH_TOTAL",
      period: "FULL_MATCH",
      marketType: "STANDARD",
      line: "2.5",
      via: "label",
    },
  },
  {
    id: "norm-total-goals-equivalent",
    label: "Total Goals O/U",
    key: "goals",
    outcomes: [
      { name: "Over 2.5" },
      { name: "Under 2.5" },
    ],
    expected: {
      matched: true,
      family: "MATCH_TOTAL",
      period: "FULL_MATCH",
      marketType: "STANDARD",
      line: "2.5",
      via: "label",
    },
  },
  {
    id: "norm-home-total-not-match-total",
    label: "Home Team Goals O/U 1.5",
    key: "team_totals_home",
    expected: {
      matched: true,
      family: "TEAM_TOTAL",
      period: "FULL_MATCH",
      marketType: "STANDARD",
      participant: "HOME",
      line: "1.5",
      via: "label",
    },
  },
  {
    id: "norm-home-asian-handicap",
    label: "Home Asian Handicap -0.75",
    key: "spreads",
    outcomes: [
      { name: "Home Team -0.75", point: "-0.75" },
      { name: "Away Team +0.75", point: "0.75" },
    ],
    expected: {
      matched: true,
      family: "ASIAN_HANDICAP",
      period: "FULL_MATCH",
      marketType: "HANDICAP",
      participant: "HOME",
      line: "-0.75",
      via: "label",
    },
  },
  {
    id: "norm-1x2",
    label: "1X2",
    key: "h2h",
    expected: {
      matched: true,
      family: "MATCH_RESULT",
      period: "FULL_MATCH",
      marketType: "1X2",
      via: "label",
    },
  },
  {
    id: "norm-match-result",
    label: "Match Result",
    key: "h2h",
    expected: {
      matched: true,
      family: "MATCH_RESULT",
      period: "FULL_MATCH",
      marketType: "1X2",
      via: "label",
    },
  },
  {
    id: "norm-btts",
    label: "Both Teams to Score",
    key: "btts",
    expected: {
      matched: true,
      family: "BTTS",
      period: "FULL_MATCH",
      marketType: "BTTS",
      via: "label",
    },
  },
  {
    id: "norm-corner-separate-family",
    label: "Total Corners 9.5",
    key: "corners",
    expected: {
      matched: true,
      family: "CORNERS",
      period: "FULL_MATCH",
      marketType: "STANDARD",
      line: "9.5",
      via: "label",
    },
  },
  {
    id: "norm-cards-separate-family",
    label: "Yellow Cards 4.5",
    key: "cards",
    expected: {
      matched: true,
      family: "CARDS",
      period: "FULL_MATCH",
      marketType: "STANDARD",
      line: "4.5",
      via: "label",
    },
  },
  {
    id: "norm-shots-rejected",
    label: "Shots O/U 2.5",
    key: "shots",
    expected: {
      matched: false,
      reasonContains: "shots",
    },
  },
  {
    id: "norm-draw-no-bet-rejected",
    label: "Draw No Bet",
    key: "dnb",
    expected: {
      matched: false,
      reasonContains: "intentionally unmapped",
    },
  },
  {
    id: "norm-unknown-key-no-label",
    key: "provider_specific_unknown",
    expected: {
      matched: false,
      reasonContains: "no label",
    },
  },
  {
    id: "norm-key-registry-totals",
    label: "Total Goals",
    key: "totals",
    outcomes: [
      { name: "Over 2.5" },
      { name: "Under 2.5" },
    ],
    expected: {
      matched: true,
      family: "MATCH_TOTAL",
      period: "FULL_MATCH",
      marketType: "STANDARD",
      line: "2.5",
      via: "key",
    },
  },
];