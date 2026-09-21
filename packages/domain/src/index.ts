/**
 * Canonical domain model for 22_VOID.
 *
 * value sets (statuses, families, periods, outcomes), the strongly typed
 * canonical event / market / selection / odds / freshness / settlement
 * objects, and their validation schemas. Engine packages must agree on these
 * shapes; see docs/ARBITRAGE_ENGINE_SPEC.md for the full semantics.
 */

export * from "./value-sets";
export * from "./decimal-odds";
export * from "./canonical-event";
export * from "./market";
export * from "./selection";
export * from "./freshness";
export * from "./settlement";
