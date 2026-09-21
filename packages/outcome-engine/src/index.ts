/**
 * @22void/outcome-engine
 *
 * Football outcome/state engine (BUILD_AGENT_PROMPT Phase 7).
 * Represents score as (H,A) with T=H+A and reduces the infinite score space to
 * representative state classes at settlement boundaries (spec §16–§20), so
 * downstream coverage/optimization work is `selections × classes`, not
 * `selections × thousands of scores`.
 *
 * Classification is delegated to `@22void/settlement`: a selection that cannot
 * settle is reported, never guessed (Rule 3).
 */

export { goalMargin, matchTotal, metricTotal } from "./score";
export type { FootballScore, MetricCounts } from "./score";

export {
  boundaryMax,
  buildStateModel,
  payoffMatrix,
  settleVector,
  settlementMatrix,
} from "./state-model";
export type {
  OutcomeState,
  StateModelOptions,
  StateModelResult,
  StateModelUnknown,
  VectorResult,
} from "./state-model";
