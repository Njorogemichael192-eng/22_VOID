/**
 * OpenAPI 3.0.3 contract for the Phase 12 HTTP API.
 *
 * Served at GET /api/v1/openapi (public, no API key) so clients and code
 * generators can bootstrap from the live deployment. Enumerations are imported
 * from @22void/domain, which is the single source of truth for the value sets —
 * the contract cannot drift from the engine's canonical statuses.
 */

import {
  EVENT_STATUS_VALUES,
  MARKET_FAMILY_VALUES,
  OPPORTUNITY_STATUS_VALUES,
  PERIOD_VALUES,
  REJECTION_REASON_VALUES,
  SELECTION_OUTCOME_VALUES,
} from "@22void/domain";

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description?: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
}

interface PagedGet {
  description: string;
  security: Array<Record<string, unknown>>;
  responses: Record<string, unknown>;
}

const pagedList = (schemaRef: string, description: string): PagedGet => ({
  description,
  security: [{ apiKey: [] }],
  responses: {
    "200": {
      description: "A page of results",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["data", "pagination"],
            properties: {
              data: { type: "array", items: { $ref: schemaRef } },
              pagination: { $ref: "#/components/schemas/Pagination" },
            },
          },
        },
      },
    },
    "400": { $ref: "#/components/responses/BadRequest" },
    "401": { $ref: "#/components/responses/Unauthorized" },
  },
});

const notFoundResponse = {
  "404": {
    description: "No such entity",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
    },
  },
};

export const openApiDocument: OpenApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "22_VOID API",
    version: "1.0.0",
    description:
      "Authenticated read API over the 22_VOID arbitrage engine: events, markets, odds, opportunities (spec §40 lifecycle including VERIFIED_ARB from Phase 11 validation), provider health, scanner status and admin audit trails.",
  },
  servers: [{ url: "http://localhost:3000", description: "Local development" }],
  tags: [
    { name: "events", description: "Canonical events and cross-source ids" },
    { name: "markets", description: "Per-source markets and odds selections" },
    { name: "odds", description: "Flat price view" },
    { name: "opportunities", description: "Detected / validated arbitrage candidates" },
    { name: "system", description: "Health, provider status, scanner heartbeats" },
    { name: "admin", description: "Admin-key endpoints (sources, audit logs)" },
    { name: "history", description: "Phase 15 historical reconstruction and analysis" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["system"],
        summary: "Liveness probe (public)",
        security: [],
        responses: { "200": { description: "Service is up" } },
      },
    },
    "/openapi": {
      get: {
        tags: ["system"],
        summary: "This document (public)",
        security: [],
        responses: { "200": { description: "OpenAPI contract" } },
      },
    },
    "/events": {
      get: {
        tags: ["events"],
        summary: "List events",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
          {
            name: "status",
            in: "query",
            schema: { $ref: "#/components/schemas/EventStatus" },
          },
          { name: "competition", in: "query", schema: { type: "string" } },
          { name: "team", in: "query", schema: { type: "string" } },
          {
            name: "startFrom",
            in: "query",
            description: "ISO-8601 lower bound (inclusive) on start time",
            schema: { type: "string", format: "date-time" },
          },
          {
            name: "startTo",
            in: "query",
            description: "ISO-8601 upper bound (inclusive) on start time",
            schema: { type: "string", format: "date-time" },
          },
        ],
        ...pagedList("#/components/schemas/Event", "Page of events"),
      },
    },
    "/events/{id}": {
      get: {
        tags: ["events"],
        summary: "Event detail with per-source event ids",
        parameters: [{ $ref: "#/components/parameters/id" }],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Event",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/Event" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": notFoundResponse["404"],
        },
      },
    },
    "/markets": {
      get: {
        tags: ["markets"],
        summary: "List markets (per-source identities, current odds included)",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
          { name: "eventId", in: "query", schema: { type: "string" } },
          {
            name: "family",
            in: "query",
            schema: { $ref: "#/components/schemas/MarketFamily" },
          },
          { name: "period", in: "query", schema: { $ref: "#/components/schemas/Period" } },
        ],
        ...pagedList("#/components/schemas/Market", "Page of markets"),
      },
    },
    "/markets/{id}": {
      get: {
        tags: ["markets"],
        summary: "Market detail with current odds per selection",
        parameters: [{ $ref: "#/components/parameters/id" }],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Market",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/Market" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": notFoundResponse["404"],
        },
      },
    },
    "/odds": {
      get: {
        tags: ["odds"],
        summary: "Flat odds view across markets",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
          { name: "eventId", in: "query", schema: { type: "string" } },
          { name: "marketId", in: "query", schema: { type: "string" } },
          { name: "bookmaker", in: "query", schema: { type: "string" } },
        ],
        ...pagedList("#/components/schemas/Odds", "Page of odds rows"),
      },
    },
    "/opportunities": {
      get: {
        tags: ["opportunities"],
        summary: "List opportunity candidates by lifecycle status",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
          {
            name: "status",
            in: "query",
            schema: { $ref: "#/components/schemas/OpportunityStatus" },
          },
          { name: "eventId", in: "query", schema: { type: "string" } },
        ],
        ...pagedList("#/components/schemas/Opportunity", "Page of opportunities"),
      },
    },
    "/opportunities/{id}": {
      get: {
        tags: ["opportunities"],
        summary: "Opportunity detail with legs and validation evidence",
        parameters: [{ $ref: "#/components/parameters/id" }],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Opportunity",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/Opportunity" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": notFoundResponse["404"],
        },
      },
    },
    "/providers": {
      get: {
        tags: ["system"],
        summary: "Provider health (ingestion status per odds source)",
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Providers",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Provider" } },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/scanner": {
      get: {
        tags: ["system"],
        summary: "Scanner status (recent runs plus aggregate health)",
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Scanner runs and aggregate",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "overall"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/ScannerRun" } },
                    overall: {
                      type: "object",
                      properties: {
                        status: { $ref: "#/components/schemas/SourceStatus" },
                        stale: {
                          type: "object",
                          nullable: true,
                          properties: {
                            sourceKey: { type: "string" },
                            since: { type: "string", format: "date-time" },
                          },
                        },
                        lastRunAt: { type: "string", format: "date-time", nullable: true },
                        runningRuns: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/admin/sources": {
      get: {
        tags: ["admin"],
        summary: "Odds sources with row counts (admin key required)",
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Sources",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/AdminSource" } },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Admin API key required",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/admin/audit-logs": {
      get: {
        tags: ["admin"],
        summary: "Audit trail (admin key required)",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { $ref: "#/components/parameters/cursor" },
          { name: "entityType", in: "query", schema: { type: "string" } },
        ],
        ...pagedList("#/components/schemas/AuditLog", "Page of audit log entries"),
        responses: {
          ...pagedList("#/components/schemas/AuditLog", "Page of audit log entries").responses,
          "403": {
            description: "Admin API key required",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/history/opportunities": {
      get: {
        tags: ["history"],
        summary: "Opportunity episodes (grouped detections with duration)",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          {
            name: "eventId",
            in: "query",
            description: "Canonical event id (EventView.canonicalEventId)",
            schema: { type: "string" },
          },
          {
            name: "status",
            in: "query",
            schema: { $ref: "#/components/schemas/OpportunityStatus" },
          },
        ],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Episodes, latest first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/OpportunityEpisode" },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/history/opportunities/{id}": {
      get: {
        tags: ["history"],
        summary: "Full reconstruction of one opportunity episode",
        description:
          "Stitches the episode, its per-detection snapshots and each leg's odds price series (with movement) back into a single historical record.",
        parameters: [{ $ref: "#/components/parameters/id" }],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Episode reconstruction",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/EpisodeReconstruction" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": notFoundResponse["404"],
        },
      },
    },
    "/history/odds": {
      get: {
        tags: ["history"],
        summary: "Per-selection price series (odds snapshots)",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { name: "selectionId", in: "query", schema: { type: "string" } },
          {
            name: "eventId",
            in: "query",
            description: "Canonical event id (all selections' series)",
            schema: { type: "string" },
          },
          { name: "from", in: "query", description: "ISO-8601 lower bound (inclusive)", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", description: "ISO-8601 upper bound (inclusive)", schema: { type: "string", format: "date-time" } },
        ],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Odds history points, ascending by observedAt",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/OddsHistoryPoint" } },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/history/latency": {
      get: {
        tags: ["history"],
        summary: "Poll-to-persist cycle latency per odds source",
        parameters: [
          { $ref: "#/components/parameters/limit" },
          { name: "sourceKey", in: "query", schema: { type: "string" } },
          { name: "after", in: "query", description: "Only cycles finished after this time (ISO-8601)", schema: { type: "string", format: "date-time" } },
        ],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "Latency statistics per source",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/SourceLatency" } },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/history/analysis": {
      get: {
        tags: ["history"],
        summary: "False-positive analysis over opportunity episodes",
        parameters: [
          { name: "after", in: "query", description: "Only episodes last seen after this time (ISO-8601)", schema: { type: "string", format: "date-time" } },
        ],
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description: "False-positive report",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/FalsePositiveReport" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "API key (API_KEY for read, ADMIN_API_KEY for /admin/*)",
      },
    },
    parameters: {
      limit: {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      cursor: {
        name: "cursor",
        in: "query",
        description: "Opaque cursor from the previous page's pagination.nextCursor",
        schema: { type: "string" },
      },
      id: { name: "id", in: "path", required: true, schema: { type: "string" } },
    },
    responses: {
      BadRequest: {
        description: "Invalid query parameters or cursor",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
      Unauthorized: {
        description: "Missing or invalid API key",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              detail: {},
            },
          },
        },
      },
      Pagination: {
        type: "object",
        required: ["limit", "nextCursor"],
        properties: {
          limit: { type: "integer" },
          nextCursor: { type: "string", nullable: true },
        },
      },
      EventStatus: { type: "string", enum: [...EVENT_STATUS_VALUES] },
      MarketFamily: { type: "string", enum: [...MARKET_FAMILY_VALUES] },
      Period: { type: "string", enum: [...PERIOD_VALUES] },
      SelectionOutcome: { type: "string", enum: [...SELECTION_OUTCOME_VALUES] },
      OpportunityStatus: { type: "string", enum: [...OPPORTUNITY_STATUS_VALUES] },
      RejectionReason: { type: "string", enum: [...REJECTION_REASON_VALUES] },
      SourceStatus: { type: "string", enum: ["UNKNOWN", "HEALTHY", "DEGRADED", "DOWN"] },
      EventSourceLink: {
        type: "object",
        required: ["sourceKey", "sourceEventId"],
        properties: {
          sourceKey: { type: "string" },
          sourceEventId: { type: "string" },
        },
      },
      Event: {
        type: "object",
        required: [
          "id",
          "canonicalEventId",
          "sport",
          "competition",
          "homeTeam",
          "awayTeam",
          "startTime",
          "status",
          "sourceLinks",
        ],
        properties: {
          id: { type: "string" },
          canonicalEventId: { type: "string" },
          sport: { type: "string" },
          competition: { type: "string" },
          homeTeam: { type: "string" },
          awayTeam: { type: "string" },
          startTime: { type: "string", format: "date-time" },
          status: { $ref: "#/components/schemas/EventStatus" },
          sourceLinks: { type: "array", items: { $ref: "#/components/schemas/EventSourceLink" } },
        },
      },
      Odds: {
        type: "object",
        required: ["id", "marketId", "bookmaker", "outcome", "odds", "observedAt"],
        properties: {
          id: { type: "string" },
          marketId: { type: "string" },
          bookmaker: { type: "string" },
          outcome: { $ref: "#/components/schemas/SelectionOutcome" },
          odds: { type: "number" },
          sourceUpdatedAt: { type: "string", format: "date-time", nullable: true },
          observedAt: { type: "string", format: "date-time" },
        },
      },
      Market: {
        type: "object",
        required: [
          "id",
          "eventId",
          "sourceKey",
          "sourceMarketId",
          "period",
          "family",
          "marketType",
          "status",
          "settlementRuleVersion",
          "odds",
        ],
        properties: {
          id: { type: "string" },
          eventId: { type: "string" },
          sourceKey: { type: "string" },
          sourceMarketId: { type: "string" },
          period: { $ref: "#/components/schemas/Period" },
          family: { $ref: "#/components/schemas/MarketFamily" },
          marketType: { type: "string" },
          participant: { type: "string", nullable: true },
          line: { type: "string", nullable: true },
          status: { type: "string", enum: ["OPEN", "SUSPENDED", "CLOSED", "VOID", "UNKNOWN"] },
          settlementRuleVersion: { type: "integer" },
          odds: { type: "array", items: { $ref: "#/components/schemas/Odds" } },
        },
      },
      OpportunityLeg: {
        type: "object",
        required: ["id", "selectionId", "bookmaker", "market", "outcome", "oddsSnapshot"],
        properties: {
          id: { type: "string" },
          selectionId: { type: "string" },
          bookmaker: { type: "string" },
          market: {
            type: "object",
            required: ["family", "marketType", "period"],
            properties: {
              family: { $ref: "#/components/schemas/MarketFamily" },
              marketType: { type: "string" },
              period: { $ref: "#/components/schemas/Period" },
              participant: { type: "string", nullable: true },
              line: { type: "string", nullable: true },
            },
          },
          outcome: { $ref: "#/components/schemas/SelectionOutcome" },
          oddsSnapshot: { type: "number" },
          stake: { type: "number", nullable: true },
          guaranteedReturn: { type: "number", nullable: true },
          settlementResult: { type: "string", nullable: true },
        },
      },
      Opportunity: {
        type: "object",
        required: ["id", "event", "status", "engineVersion", "detectedAt", "legs"],
        properties: {
          id: { type: "string" },
          event: {
            type: "object",
            required: ["id", "homeTeam", "awayTeam", "startTime", "status"],
            properties: {
              id: { type: "string" },
              competition: { type: "string" },
              homeTeam: { type: "string" },
              awayTeam: { type: "string" },
              startTime: { type: "string", format: "date-time" },
              status: { $ref: "#/components/schemas/EventStatus" },
            },
          },
          status: { $ref: "#/components/schemas/OpportunityStatus" },
          rejectionReason: { oneOf: [{ $ref: "#/components/schemas/RejectionReason" }, { type: "null" }] },
          marketStructure: { type: "string", nullable: true },
          totalStake: { type: "number", nullable: true },
          minReturn: { type: "number", nullable: true },
          guaranteedProfit: { type: "number", nullable: true },
          roi: { type: "number", nullable: true },
          worstState: { type: "string", nullable: true },
          engineVersion: { type: "string" },
          normalizerVersion: { type: "string", nullable: true },
          settlementVersion: { type: "string", nullable: true },
          optimizerVersion: { type: "string", nullable: true },
          detectedAt: { type: "string", format: "date-time" },
          validatedAt: { type: "string", format: "date-time", nullable: true },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          legs: { type: "array", items: { $ref: "#/components/schemas/OpportunityLeg" } },
        },
      },
      Provider: {
        type: "object",
        required: ["key", "displayName", "status"],
        properties: {
          key: { type: "string" },
          displayName: { type: "string" },
          baseUrl: { type: "string", nullable: true },
          status: { $ref: "#/components/schemas/SourceStatus" },
          lastSeenAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      AdminSource: {
        allOf: [
          { $ref: "#/components/schemas/Provider" },
          {
            type: "object",
            required: ["marketCount", "rawPayloadCount", "scannerRunCount", "settlementRuleCount"],
            properties: {
              marketCount: { type: "integer" },
              rawPayloadCount: { type: "integer" },
              scannerRunCount: { type: "integer" },
              settlementRuleCount: { type: "integer" },
            },
          },
        ],
      },
      ScannerRun: {
        type: "object",
        required: ["runId", "status", "startedAt"],
        properties: {
          runId: { type: "string" },
          sourceKey: { type: "string", nullable: true },
          status: { $ref: "#/components/schemas/SourceStatus" },
          message: { type: "string", nullable: true },
          startedAt: { type: "string", format: "date-time" },
          finishedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      AuditLog: {
        type: "object",
        required: ["id", "action", "createdAt"],
        properties: {
          id: { type: "string" },
          opportunityId: { type: "string", nullable: true },
          entityType: { type: "string", nullable: true },
          entityId: { type: "string", nullable: true },
          action: { type: "string" },
          actor: { type: "string", nullable: true },
          detail: {},
          createdAt: { type: "string", format: "date-time" },
        },
      },
      OpportunityEpisode: {
        type: "object",
        required: [
          "id",
          "eventCanonicalId",
          "homeTeam",
          "awayTeam",
          "startTime",
          "structureType",
          "status",
          "firstSeenAt",
          "lastSeenAt",
          "detectedCount",
          "durationMs",
        ],
        properties: {
          id: { type: "string" },
          eventCanonicalId: { type: "string" },
          competition: { type: "string" },
          homeTeam: { type: "string" },
          awayTeam: { type: "string" },
          startTime: { type: "string", format: "date-time" },
          structureType: { type: "string" },
          marketStructure: { type: "string", nullable: true },
          status: { $ref: "#/components/schemas/OpportunityStatus" },
          firstSeenAt: { type: "string", format: "date-time" },
          lastSeenAt: { type: "string", format: "date-time" },
          detectedCount: { type: "integer" },
          disappearedAt: { type: "string", format: "date-time", nullable: true },
          durationMs: { type: "number" },
        },
      },
      OddsHistoryPoint: {
        type: "object",
        required: ["selectionId", "eventCanonicalId", "bookmaker", "outcome", "odds", "observedAt"],
        properties: {
          selectionId: { type: "string" },
          eventCanonicalId: { type: "string" },
          family: { $ref: "#/components/schemas/MarketFamily" },
          marketType: { type: "string" },
          period: { $ref: "#/components/schemas/Period" },
          participant: { type: "string", nullable: true },
          line: { type: "string", nullable: true },
          outcome: { $ref: "#/components/schemas/SelectionOutcome" },
          bookmaker: { type: "string" },
          odds: { type: "number" },
          observedAt: { type: "string", format: "date-time" },
          sourceUpdatedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      EpisodeReconstruction: {
        type: "object",
        required: ["episode", "detections", "legs"],
        properties: {
          episode: { $ref: "#/components/schemas/OpportunityEpisode" },
          detections: {
            type: "array",
            items: { $ref: "#/components/schemas/Opportunity" },
          },
          legs: {
            type: "array",
            items: {
              type: "object",
              required: ["selectionId", "bookmaker", "outcome", "market", "snapshotOdds", "movement"],
              properties: {
                selectionId: { type: "string" },
                bookmaker: { type: "string" },
                outcome: { $ref: "#/components/schemas/SelectionOutcome" },
                market: {
                  type: "object",
                  required: ["family", "marketType", "period"],
                  properties: {
                    family: { $ref: "#/components/schemas/MarketFamily" },
                    marketType: { type: "string" },
                    period: { $ref: "#/components/schemas/Period" },
                    participant: { type: "string", nullable: true },
                    line: { type: "string", nullable: true },
                  },
                },
                snapshotOdds: { type: "number" },
                history: { type: "array", items: { $ref: "#/components/schemas/OddsHistoryPoint" } },
                movement: {
                  type: "object",
                  required: ["first", "last", "min", "max", "delta", "pctChange"],
                  properties: {
                    first: { type: "number" },
                    last: { type: "number" },
                    min: { type: "number" },
                    max: { type: "number" },
                    delta: { type: "number" },
                    pctChange: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
      SourceLatency: {
        type: "object",
        required: ["sourceKey", "runs", "avgMs", "minMs", "maxMs"],
        properties: {
          sourceKey: { type: "string" },
          runs: { type: "integer" },
          avgMs: { type: "number" },
          minMs: { type: "number" },
          maxMs: { type: "number" },
          lastRunAt: { type: "string", format: "date-time", nullable: true },
          lastLatencyMs: { type: "number", nullable: true },
        },
      },
      FalsePositiveReport: {
        type: "object",
        required: [
          "episodes",
          "active",
          "concluded",
          "verified",
          "falsePositives",
          "falsePositiveRate",
          "byStatus",
        ],
        properties: {
          episodes: { type: "integer" },
          active: { type: "integer" },
          concluded: { type: "integer" },
          verified: { type: "integer" },
          falsePositives: { type: "integer" },
          falsePositiveRate: { type: "number" },
          byStatus: {
            type: "array",
            items: {
              type: "object",
              required: ["status", "count", "avgDurationMs"],
              properties: {
                status: { $ref: "#/components/schemas/OpportunityStatus" },
                count: { type: "integer" },
                avgDurationMs: { type: "number" },
              },
            },
          },
          topRejectionReasons: {
            type: "array",
            items: {
              type: "object",
              required: ["reason", "count"],
              properties: { reason: { type: "string" }, count: { type: "integer" } },
            },
          },
        },
      },
    },
  },
};