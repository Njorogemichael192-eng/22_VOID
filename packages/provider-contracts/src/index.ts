/**
 * @22void/provider-contracts
 *
 * Provider abstraction layer (BUILD_AGENT_PROMPT Phase 3).
 * Defines the `OddsProvider` interface that adapter implementations (MockProvider,
 * ParlayAPI adapter, Odds-API.io adapter) must satisfy. Provider-specific code
 * must stay inside adapters; the core engine must not know provider details.
 *
 * Status: Phase 0 skeleton. Interface is defined in Phase 3.
 */

import type { RejectionReason } from "@22void/domain";

/** Placeholder for the canonical provider-adjusted event record defined in Phase 3. */
export interface ProviderEvent {
  provider: string;
  id: string;
}

/** Placeholder for a provider health record (Phase 12/14). */
export interface ProviderHealth {
  provider: string;
  reachable: boolean;
  error?: RejectionReason;
}

/** Marker so the package ships a typed public API until Phase 3 fills it in. */