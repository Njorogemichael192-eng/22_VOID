-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED', 'ABANDONED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('OPEN', 'SUSPENDED', 'CLOSED', 'VOID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "MarketFamily" AS ENUM ('MATCH_RESULT', 'DOUBLE_CHANCE', 'MATCH_TOTAL', 'ASIAN_TOTAL', 'ASIAN_HANDICAP', 'TEAM_TOTAL', 'TEAM_ASIAN_TOTAL', 'CORNERS', 'CARDS', 'BTTS', 'EXACT_SCORE');

-- CreateEnum
CREATE TYPE "Period" AS ENUM ('FULL_MATCH', 'FIRST_HALF', 'SECOND_HALF', 'EXTRA_TIME', 'PENALTIES');

-- CreateEnum
CREATE TYPE "SelectionOutcomeType" AS ENUM ('HOME', 'DRAW', 'AWAY', 'OVER', 'UNDER', 'BTTS_YES', 'BTTS_NO', 'HOME_OR_DRAW', 'AWAY_OR_DRAW', 'HOME_OR_AWAY');

-- CreateEnum
CREATE TYPE "SettlementResultType" AS ENUM ('FULL_WIN', 'FULL_LOSS', 'PUSH', 'HALF_WIN', 'HALF_LOSS', 'VOID');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DETECTED', 'VALIDATING', 'THEORETICAL_ARB', 'FRESH_ARB', 'VERIFIED_ARB', 'STALE', 'INVALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RejectionReasonType" AS ENUM ('UNKNOWN_SETTLEMENT', 'EVENT_MISMATCH', 'EVENT_MATCH_FAILED', 'EVENT_MATCH_UNCERTAIN', 'PERIOD_MISMATCH', 'NON_EXHAUSTIVE', 'NON_EXCLUSIVE', 'BOTH_LOSS_STATE', 'NEGATIVE_GUARANTEED_PROFIT', 'STALE_ODDS', 'INVALID_ODDS', 'INVALID_ODDS_PAYLOAD', 'INVALID_MARKET', 'UNSUPPORTED_MARKET', 'NO_STATE_MODEL', 'INCOMPLETE_COVERAGE', 'STAKE_LIMIT', 'ROUNDING_DESTROYS_PROFIT', 'OPTIMIZATION_FAILED', 'PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "canonicalEventId" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "competition" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_event_ids" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "oddsSourceId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3),
    "homeTeam" TEXT,
    "awayTeam" TEXT,
    "competition" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_event_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_aliases" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "oddsSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmakers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookmakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odds_sources" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "odds_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_rules" (
    "id" TEXT NOT NULL,
    "oddsSourceId" TEXT NOT NULL,
    "family" "MarketFamily" NOT NULL,
    "marketType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT,
    "ruleJson" JSONB,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "oddsSourceId" TEXT NOT NULL,
    "sourceMarketId" TEXT NOT NULL,
    "settlementRuleId" TEXT NOT NULL,
    "period" "Period" NOT NULL,
    "family" "MarketFamily" NOT NULL,
    "marketType" TEXT NOT NULL,
    "participant" TEXT,
    "line" TEXT,
    "status" "MarketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selections" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "bookmakerId" TEXT NOT NULL,
    "outcome" "SelectionOutcomeType" NOT NULL,
    "odds" DECIMAL(12,6) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odds_observations" (
    "id" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "odds" DECIMAL(12,6) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB,

    CONSTRAINT "odds_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_payloads" (
    "id" TEXT NOT NULL,
    "oddsSourceId" TEXT NOT NULL,
    "requestId" TEXT,
    "endpoint" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DETECTED',
    "rejectionReason" "RejectionReasonType",
    "marketStructure" TEXT,
    "totalStake" DECIMAL(14,6),
    "minReturn" DECIMAL(14,6),
    "guaranteedProfit" DECIMAL(14,6),
    "roi" DECIMAL(14,6),
    "worstState" TEXT,
    "engineVersion" TEXT NOT NULL,
    "normalizerVersion" TEXT,
    "settlementVersion" TEXT,
    "optimizerVersion" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_legs" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "oddsSnapshot" DECIMAL(12,6) NOT NULL,
    "stake" DECIMAL(14,6),
    "guaranteedReturn" DECIMAL(14,6),
    "settlementResult" "SettlementResultType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scanner_health" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "oddsSourceId" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scanner_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_canonicalEventId_key" ON "events"("canonicalEventId");

-- CreateIndex
CREATE INDEX "events_startTime_idx" ON "events"("startTime");

-- CreateIndex
CREATE INDEX "source_event_ids_eventId_idx" ON "source_event_ids"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "source_event_ids_oddsSourceId_sourceEventId_key" ON "source_event_ids"("oddsSourceId", "sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE INDEX "team_aliases_teamId_idx" ON "team_aliases"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "team_aliases_alias_oddsSourceId_key" ON "team_aliases"("alias", "oddsSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmakers_name_key" ON "bookmakers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "odds_sources_key_key" ON "odds_sources"("key");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_rules_oddsSourceId_family_marketType_version_key" ON "settlement_rules"("oddsSourceId", "family", "marketType", "version");

-- CreateIndex
CREATE INDEX "markets_eventId_family_period_line_idx" ON "markets"("eventId", "family", "period", "line");

-- CreateIndex
CREATE UNIQUE INDEX "markets_oddsSourceId_sourceMarketId_key" ON "markets"("oddsSourceId", "sourceMarketId");

-- CreateIndex
CREATE INDEX "selections_outcome_idx" ON "selections"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "selections_marketId_bookmakerId_outcome_key" ON "selections"("marketId", "bookmakerId", "outcome");

-- CreateIndex
CREATE INDEX "odds_observations_selectionId_observedAt_idx" ON "odds_observations"("selectionId", "observedAt");

-- CreateIndex
CREATE INDEX "raw_payloads_oddsSourceId_receivedAt_idx" ON "raw_payloads"("oddsSourceId", "receivedAt");

-- CreateIndex
CREATE INDEX "opportunities_status_detectedAt_idx" ON "opportunities"("status", "detectedAt");

-- CreateIndex
CREATE INDEX "opportunity_legs_selectionId_idx" ON "opportunity_legs"("selectionId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_legs_opportunityId_selectionId_key" ON "opportunity_legs"("opportunityId", "selectionId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "scanner_health_runId_key" ON "scanner_health"("runId");

-- CreateIndex
CREATE INDEX "scanner_health_oddsSourceId_startedAt_idx" ON "scanner_health"("oddsSourceId", "startedAt");

-- AddForeignKey
ALTER TABLE "source_event_ids" ADD CONSTRAINT "source_event_ids_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_event_ids" ADD CONSTRAINT "source_event_ids_oddsSourceId_fkey" FOREIGN KEY ("oddsSourceId") REFERENCES "odds_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_oddsSourceId_fkey" FOREIGN KEY ("oddsSourceId") REFERENCES "odds_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_rules" ADD CONSTRAINT "settlement_rules_oddsSourceId_fkey" FOREIGN KEY ("oddsSourceId") REFERENCES "odds_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_oddsSourceId_fkey" FOREIGN KEY ("oddsSourceId") REFERENCES "odds_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_settlementRuleId_fkey" FOREIGN KEY ("settlementRuleId") REFERENCES "settlement_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_bookmakerId_fkey" FOREIGN KEY ("bookmakerId") REFERENCES "bookmakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odds_observations" ADD CONSTRAINT "odds_observations_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_oddsSourceId_fkey" FOREIGN KEY ("oddsSourceId") REFERENCES "odds_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_legs" ADD CONSTRAINT "opportunity_legs_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_legs" ADD CONSTRAINT "opportunity_legs_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_health" ADD CONSTRAINT "scanner_health_oddsSourceId_fkey" FOREIGN KEY ("oddsSourceId") REFERENCES "odds_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
