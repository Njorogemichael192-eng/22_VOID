# Provider Evaluation (Phase 3)

Date: 2026-09-21 · Record-holder: engineer

Goal (from PROJECT_STATE Phase 3): pick the initial odds provider for 22_VOID,
implement its adapter behind the `OddsProvider` interface, and prove the Phase 3
acceptance — **a live payload converts to canonical records**.

## Candidates

|                                    | ParlayAPI (parlay-api.com)                                                                | The Odds API (the-odds-api.com)                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                               | `X-API-Key` header                                                                        | `?apiKey=` query param                                                                                                                                                                                                     |
| Feeds                              | 30+ bookmakers, odds only (client must book)                                              | 1-min updates, bookmaker odds                                                                                                                                                                                              |
| Soccer markets (documented)        | h2h_3_way, totals, team_totals, double_chance, btts, correct_score, draw_no_bet           | featured: h2h, totals; additional: h2h_3_way, btts, double_chance, team_totals, correct_score, draw_no_bet, alternates, plus corners/cards **only** via "additional markets"                                               |
| Corners / cards                    | Not documented for soccer                                                                 | `alternate_totals_corners`, `alternate_totals_cards` (US-spotlight bookmakers)                                                                                                                                             |
| Asian quarter-handicap/total lines | Not documented                                                                            | Not documented                                                                                                                                                                                                             |
| Football handcaps ("spreads")      | Not documented                                                                            | Soccer spreads exist but **settlement unverified** → intentionally unmapped (Rule 3)                                                                                                                                       |
| Regions                            | us-centric                                                                                | us / us2 / uk / eu / au                                                                                                                                                                                                    |
| Kenya / Africa                     | None listed                                                                               | None listed                                                                                                                                                                                                                |
| Free tier                          | 1,000 credits/quarter-style free allowance; **non-commercial / personal / research only** | 100 req/hr, 500 req/day, 2 recreational bookmakers; commercial requires paid upgrade                                                                                                                                       |
| Redistribution                     | Prohibited without written agreement; commercial display needs Business + attribution     | TOS (The Odds API Pty Ltd, ACN 627461947): reselling/repackaging the feed as a standalone product prohibited; storage, dashboards, derived analytics and commercial use permitted when the feed is not the primary product |
| Feeds per source                   | Server-published event id, market keys                                                    | `id` per event, `sport_key`, `commence_time`, `last_update` per market/bookmaker                                                                                                                                           |

## Decision

**Initial provider: The Odds API** (`odds-api`).

Reasons:

1. Clean, documented API with 1-minute updates and ISO timestamps on every
   level (`event`, `market`, `bookmaker` last_update) — matches the freshness
   model directly (spec §38).
2. Soccer coverage matches the verified canonical market set: h2h, totals,
   team totals, BTTS, double chance, correct score, plus corners/cards through
   additional markets.
3. TOS supports storage of the raw payload, dashboards and derived analytics —
   sufficient for the platform as long as the feed is not the primary product.
4. Free tier is workable during build-out before the paid commercial tier is
   enabled at deploy time.

**ParlayAPI** is implemented as an interface-compliant adapter skeleton and
fixture-regressed now; it becomes "Provider B" in Phase 19 (multi-provider)
once its exact wire shape is verified against live docs and its commercial
terms are negotiated. It is deliberately NOT the initial provider.

## Coverage gaps (recorded, not blocking)

- **Asian quarter lines** (2.25, 0.75 handles/totals) are not offered by either
  candidate. The engine still needs them (Phases 7–9 are built for quarter
  lines); they will be sourced in Phase 19 as a supplementary feed. The
  taxonomy and MockProvider already exercise them so the pipeline is ready.
- **Corners / cards** only via Odds-API "additional markets", which are
  US-bookmaker focused. Adapter registers `alternate_totals_corners` /
  `alternate_totals_cards` so the canonical records flow when present.
- **Soccer spreads and draw_no_bet** exist in the Odds API catalogue but their
  settlement semantics are unverified — they are intentionally NOT registered
  (`Rule 3: unknown settlement means no arb`).
- **Kenya / African bookmakers** absent from both catalogues. Focus is on
  detecting arbs across whatever books are available; Kenyan licenses would
  apply at the operator level, not the feed level.

## How the adapter maps to canonical records

1. `poll()` requests `GET /v4/sports/{sport}/odds?apiKey&regions&markets&oddsFormat=decimal&dateFormat=iso`
   (defaults `soccer_epl`, regions `uk,eu`, markets `h2h,totals`).
2. Wire body validated with a zod schema in `packages/provider-contracts/src/adapters/odds-api.ts`.
3. Generic translation (`providers/translate.ts`) normalizes the
   event→bookmaker→market→outcome shape into the provider envelope using the
   market-key registry (`providers/keys.ts`):
   - outcome labels → canonical outcomes (`providers/outcomes.ts`), e.g.
     team names → HOME/AWAY, "Over 2.5" → OVER (+line "2.5"),
     "Yes/No" → BTTS_YES/BTTS_NO, "2-1" → exact score "2-1", "П2" → AWAY.
   - team_totals wire keys are split into per-participant markets.
   - unknown markets/outcomes are skipped and recorded, never guessed.
4. `envelopeToCanonicalRecords()` (`canonical.ts`) emits Phase-4-style
   canonicalEvent/canonicalSelection records with `observedAt = receivedAt` and
   `sourceUpdatedAt` clamped to `receivedAt` (clock-skew safety). Provisional
   `canonicalEventId = "<provider>:<providerEventId>"` until Phase 4 matching.
5. The verbatim wire body is wrapped in a `RawProviderPayload` for storage
   (spec §65) — see `storeRawPayload` in `@22void/db`.

## Rights / compliance notes (Phase 16 re-verification point)

Re-verified 2026-09-24 (Phase 16 — SECURITY). Unchanged from Phase 3 with one
addition (rotation):

- The Odds API Pty Ltd ACN 627461947 TOS: no resale/repackaging of the raw
  feed as a standalone product; no re-licensing the data to third parties for
  their commercial products; storage/dashboards/derived analytics allowed.
- ParlayAPI: free tier non-commercial only; commercial use requires Business
  plan + attribution; redistribution requires a written agreement.
- **Key rotation (incident)**: a real Dell-free-tier ParlayAPI key was found
  committed in `.env.example` (introduced during Phase 3 exploration). It has
  been removed from the working tree and `npm run security:scan` now gates CI
  against committed credentials. The key is irrecoverable in git history
  (remote `origin` has it) — **rotate/revoke it in the ParlayAPI console**.
  Both provider keys are server-side env only, never in the browser bundle.
- **Authorized access only**: 22_VOID polls provider REST endpoints with its
  own API keys, honoring advertised quotas. It never bypasses bookmaker
  CAPTCHA, bot detection, authentication, geo controls, rate limits or access
  controls. Bookmaker accounts/placement are out of scope; this is a pricing
  research platform.
- **Rate limiting is two-layered**: the collector's token bucket throttles
  provider polling (spec §38/§72); the API's per-IP token bucket protects
  `/api/v1/*` (Phase 16). Both are quota preservation, not evasions.
- **Data minimization**: raw provider payloads are retained only for debugging
  (spec §65 retention; not publicly served), keys never appear in payloads,
  and the dashboard shows no account/credential data.
- **Kenya / Africa**: no African bookmakers in either catalogue; Kenyan
  licensing/ops compliance is an operator-level concern, not a feed-level one.

## The Odds API vs ParlayAPI — Phase 16 consolidation

Nothing changed the Phase 3 decision. The Odds API remains the initial
provider; ParlayAPI remains "Provider B" (Phase 19) pending exact wire-shape
verification and commercial terms. Phase 19 will also re-check the Asian
quarter-line coverage gap above.
