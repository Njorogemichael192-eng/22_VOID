/**
 * @22void/arbitrage
 *
 * False-arb detector + stake optimizer (BUILD_AGENT_PROMPT Phases 8–9).
 * Phase 8 builds the payoff/settlement matrix for every relevant state class,
 * verifies full coverage (no both-loss, overlap or push/gap states) and emits
 * structured, human-readable rejection reasons. Phase 9 (stake optimizer) then
 * decides whether the covered structure actually guarantees `min return > T`.
 *
 * But the authoritative arb test is always the state model — never
 * `sum(1/odds) < 1` alone (spec §23–§27, §41).
 */

export { detectFalseArb, formatCoverageReport, formatRejection } from "./coverage";
export type {
  ArbitrageLeg,
  CoverageReport,
  FalseArbVerdict,
  OverlapKind,
  RejectionEvidence,
  StateGap,
  StateOverlap,
} from "./coverage";

export {
  bestPricePerSelection,
  classifyStructure,
  familiesCompatible,
  formatPruneVerdict,
  generateCandidates,
  isStandardComplement,
  pruneCandidate,
  pruneCandidates,
  scanCandidates,
} from "./candidates";
export type {
  Candidate,
  CandidateGeneratorOptions,
  CandidatePruneOptions,
  CandidateScan,
  PricedSelection,
  PruneReason,
  PruneResult,
  PruneVerdict,
  ScanOptions,
  StructureType,
} from "./candidates";

export {
  buildMultiplierMatrix,
  classicThreeWayStakes,
  classicTwoWayStakes,
  optimizeCandidate,
  optimizeStakes,
  reciprocalSum,
} from "./optimizer";
export type { StakePlan } from "./optimizer";
