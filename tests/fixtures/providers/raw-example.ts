import type { WireEvent } from "@22void/provider-contracts";

/**
 * Raw reference-provider ("example") GET /odds response body (fixture).
 *
 * The credential-free sample the adapter template in
 * docs/ADDING_A_PROVIDER.md is built around: a generic
 * event→bookmaker→market→outcome document mapped through EXAMPLE_MARKET_KEYS.
 * It is a fixture, not provider traffic — the reference adapter exists to
 * exercise the add-a-provider surface, not to price real markets.
 */
export const EXAMPLE_SOCCER_RAW: WireEvent[] = [
  {
    id: "example-epl-001",
    sport_key: "soccer_epl",
    sport_title: "England - Premier League",
    commence_time: "2026-11-21T19:00:00.000Z",
    home_team: "Manchester City",
    away_team: "Arsenal",
    status: "scheduled",
    bookmakers: [
      {
        key: "example-book",
        title: "ExampleBook",
        last_update: "2026-11-20T18:06:00.000Z",
        markets: [
          {
            key: "h2h",
            last_update: "2026-11-20T18:05:00.000Z",
            outcomes: [
              { name: "Manchester City", price: 1.9 },
              { name: "Arsenal", price: 4.25 },
              { name: "Draw", price: 3.6 },
            ],
          },
          {
            key: "totals",
            last_update: "2026-11-20T18:05:00.000Z",
            outcomes: [
              { name: "Over 2.5", price: 1.8, point: 2.5 },
              { name: "Under 2.5", price: 2.0, point: 2.5 },
            ],
          },
        ],
      },
    ],
  },
];
