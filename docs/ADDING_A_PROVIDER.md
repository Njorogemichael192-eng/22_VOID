# Adding an Odds Provider

Date: 2026-10-10 · Record-holder: engineer

This is the template for adding a new odds feed to 22_VOID. It exists to keep the
Phase 19 acceptance literal: **adding a provider requires no core-engine rewrite**.
A provider is an *adapter* plus a small amount of wiring; nothing under
`packages/arbitrage`, `packages/db`, `packages/normalization` or `apps/web` should
change, because the engine consumes only the normalized provider *envelope* and
never a provider-specific wire shape (see `docs/ARCHITECTURE.md`, "module
boundaries").

A worked, credential-free example ships in the repo: the **`example` provider**.

- Adapter: `packages/provider-contracts/src/adapters/example.ts`
- Market registry: `EXAMPLE_MARKET_KEYS` in `packages/provider-contracts/src/providers/keys.ts`
- Fixture: `tests/fixtures/providers/raw-example.ts`
- Adapter tests: `packages/provider-contracts/src/adapters/example.test.ts`
- Config wiring: `workers/odds-collector/src/config.ts` (`resolveExampleProvider`)
- Runtime wiring: `workers/odds-collector/src/main.ts` (`createProvider`)

It is deliberately **development-only**: it serves fixture data, so both
`config.ts` and `infra/scripts/validate-env.sh` refuse it in production, exactly
as they refuse `mock`. When forking it into a real feed you delete that guard.

---

## The surface a provider touches

| # | File | Change |
| - | ---- | ------ |
| 1 | `packages/provider-contracts/src/provider-id.ts` | add the key to `PROVIDER_KEYS` |
| 2 | `packages/provider-contracts/src/providers/keys.ts` | add the provider's market-key registry |
| 3 | `packages/provider-contracts/src/adapters/<name>.ts` | the adapter class |
| 4 | `packages/provider-contracts/src/index.ts` | export the adapter |
| 5 | `workers/odds-collector/src/config.ts` | `PROVIDER_NAMES`, the `ResolvedProviderConfig` variant, a resolver |
| 6 | `workers/odds-collector/src/main.ts` | one line in `createProvider` |
| 5b | `infra/scripts/validate-env.sh` | mirror the config refusals at the prod entrypoint |
| 6 | `.env.example` (and `infra/env.prod.example` for a live feed) | document the env vars |
| 7 | tests + this doc's checklist | see below |

If a change is needed anywhere else, the abstraction has leaked — stop and treat
that as a bug in the envelope layer, not as part of the provider.

---

## Step 1 — Register the provider key

`packages/provider-contracts/src/provider-id.ts`:

```ts
export const PROVIDER_KEYS = ["mock", "odds-api", "parlay-api", "example", "your-provider"] as const;
```

`ProviderKey` is derived from this list and `providerKeySchema` is the zod enum
over it, so adding the string here is what makes the key valid in a
`RawProviderPayload`, an envelope, and every stored record.

## #2 — Market-key registry

`packages/provider-contracts/src/providers/keys.ts` maps each **provider-native**
market key to the canonical taxonomy (`family`, `marketType`, `period`,
`usesPoint`, and for team totals `teamSplit`). Add a
`Readonly<Record<string, MarketKeySpec>>` for your provider, e.g.
`MY_PROVIDER_MARKET_KEYS`.

**Rule 3 applies here:** only register a market whose *settlement semantics you
have verified*. An unknown market or outcome is skipped and recorded, never
guessed — that is why soccer spreads and `draw_no_bet` are absent from every
existing registry even though the feeds carry them.

## The adapter

Copy `adapters/example.ts`. Every adapter implements the same `OddsProvider`
contract (`packages/provider-contracts/src/odds-provider.ts`):

```ts
interface OddsProvider {
  readonly providerKey: ProviderKey;
  poll(request?: PollRequest): Promise<PollResult>;
  health(): Promise<ProviderHealth>;
  quotaSnapshot?(): ProviderQuota | undefined; // metered feeds only
}
```

The shape is always:

1. **Build the URL** from the per-request `PollRequest` and the adapter's config
   (config owns the defaults; `poll` may override sport/regions/markets).
2. **Fetch** with `fetchJson` (`providers/http.ts`), which applies the timeout,
   redacts the URL in errors, and reports quota headers through `onMeta`. Throw
   `ProviderTransportError` on transport failure so the worker can distinguish
   PROVIDER_UNAVAILABLE from PROVIDER_ERROR.
3. **Validate the wire body** with a zod schema for *that provider's* shape.
4. **Translate** with `translateProviderOdds(wireEvents, <PROVIDER>_MARKET_KEYS,
   providerKey, requestId, receivedAt, competitionFor?, statusFor?)`
   (`providers/translate.ts`). Outcomes are mapped through
   `providers/outcomes.ts`; unknown markets/outcomes are collected into
   `skippedOutcomes`, never guessed.
5. **Parse the envelope** with `providerEnvelopeSchema` and return it alongside
   `buildRawPayload(...)` — the verbatim wire body retained for §65.
5. `health()` hits a lightweight endpoint and reports `reachable`.

The adapter must not import from `@22void/arbitrage`, `@22void/db` or any app.
If it needs a new canonical outcome or line format, that is a domain change and a
review point, not an adapter detail.

## Wiring it in

**Registry/export** — add the file to `packages/provider-contracts/src/index.ts`.

**Config** (`workers/odds-collector/src/config.ts`):

1. Add the name to `PROVIDER_NAMES`.
2. Add a variant to `ResolvedProviderConfig` (`{ kind: "<name>"; config: <Config> }`).
3. Add a branch to `resolveOneProvider`.
4. Add a `resolve<Name>Provider` that reads its env vars. Reuse `resolveBaseUrl`
   (https-only in production, no embedded credentials, no credential query
   parameter) and `optionalProviderValue` (rejects an explicitly empty value in
   production rather than silently falling back to an adapter default).

**Runtime** (`workers/odds-collector/src/main.ts`): add one line to
`createProvider`.

Because `WORKER_PROVIDER` is a comma list and `runScanCycle` already polls every
entry before detecting once, the new feed participates in cross-provider
detection the moment it is named — no engine change.

## Guards to preserve

These exist because each failure mode *reports success while doing the wrong
thing*. Copy them; do not weaken them:

- **Unknown names fail loudly.** An unrecognized provider must never resolve to
  `mock` (a typo once served invented odds).
- **Empty list entries fail.** `odds-api,` must not silently narrow the cycle.
- **Repeats fail.** Polling one feed twice bills its quota twice.
- **Synthetic feeds never mix with real ones.** `mock` (and the `example`
  reference adapter) may not sit in the same detection pass as a real feed.
- **Synthetic feeds are refused in production.** Persisting fixture prices turns
  them into "real" opportunities with no visible sign.

## Environment

Document the provider's variables in `.env.example` (and `infra/env.prod.example`
for a production feed), and mirror the provider name/refusals in
`infra/scripts/validate-env.sh` so a bad value fails once at the container
entrypoint instead of inside a `restart: unless-stopped` loop.

## Test checklist

- **Adapter** (`adapters/<name>.test.ts`, stub `fetch` like
  `parlay-api.test.ts`): the request URL and auth header; the fixture translates
  to the expected canonical markets/outcomes/lines; the raw payload is recorded;
  `health()` reports reachable and unreachable.
- **Fixture** (`tests/fixtures/providers/raw-<name>.ts`): a captured response
  body, so the wire dialect is pinned against regressions.
- **Config** (`config.test.ts`): the name resolves from its env; a missing
  required value throws; production refusal and synthetic-mix refusal if
  applicable; the "unknown provider" message lists the new name.
- **Public API** (`index.test.ts`): `providerKeySchema` accepts the new key and
  the provider class is exported.

## Acceptance

The change is complete when `npm run lint`, `npm run typecheck`, `npm test`,
`npm run build`, `npm run security:scan` and `npm run state:check` are green and
`git diff --stat` shows **no** change under `packages/arbitrage`,
`packages/db`, `packages/normalization` or `apps/`. That diff *is* the proof that
provider addition needs no core-engine rewrite.
