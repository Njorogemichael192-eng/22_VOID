/**
 * @22void/provider-contracts
 *
 * Provider abstraction layer (BUILD_AGENT_PROMPT Phase 3).
 *
 * - `OddsProvider` interface: the only surface the scanner/engine touches. Live
 *   adapter concerns (wire shapes, auth, endpoints, market-key dialects) stay
 *   inside `adapters/` and `providers/`; the engine must not know them.
 * - Provider envelope: a provider-normalized transfer structure carrying
 *   canonical families plus provider-canonical market/outcome/price notes and
 *   two clock values — `receivedAt` (ingest time) and per-price
 *   `sourceUpdatedAt` (provider's update time).
 * - Canonical records: conversion of an envelope into Phase-4
 *   canonicalEvent/canonicalSelection records. Records that do not satisfy the
 *   domain schema are collected as `rejected`, never guessed.
 *
 * Providers: MockProvider (deterministic fixture harness), OddsApiProvider
 * (initial), ParlayApiProvider (adapter skeleton for the multi-provider phase).
 */

export * from "./provider-id.js";
export * from "./envelope.js";
export * from "./odds-provider.js";
export * from "./canonical.js";
export * from "./providers/keys.js";
export * from "./providers/outcomes.js";
export * from "./providers/translate.js";
export * from "./mock-provider.js";
export * from "./adapters/odds-api.js";
export * from "./adapters/parlay-api.js";
export * from "./providers/http.js";
