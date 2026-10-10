-- Phase 19 Step 5: cross-provider market reconciliation.
--
-- Moves market uniqueness from the per-source key (oddsSourceId, sourceMarketId)
-- to the canonical within-event structure identity (eventId, canonicalMarketId),
-- and records each contributing provider's original market identity in a new
-- market_source_ids join table. Selections gain a marketSourceId so that
-- provenance (provider / source status / settlement rule) stays per-source after
-- two providers' markets fold into one row — without it, loadPricedSelections
-- would attribute every folded selection to the surviving market's source and
-- could promote an arb backed by a DOWN provider or the wrong settlement rule.
--
-- The migration is data preserving: existing one-source-per-market rows are
-- backfilled verbatim (one market_source_ids row each, every selection pointed
-- at its own market's row); no market, selection or observation is dropped.
--
-- Current production data has zero duplicate canonical market identities, so the
-- new unique index is satisfied by the backfill with nothing to reconcile. The
-- reconcile CLI handles historical duplicates when they exist.

-- CreateTable
CREATE TABLE "market_source_ids" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "oddsSourceId" TEXT NOT NULL,
    "sourceMarketId" TEXT NOT NULL,
    "settlementRuleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_source_ids_pkey" PRIMARY KEY ("id")
);

-- AlterTable: canonical market identity (nullable first, backfilled, then NOT NULL)
ALTER TABLE "markets" ADD COLUMN "canonicalMarketId" TEXT;

UPDATE "markets"
SET "canonicalMarketId" =
    "family"::text || '|' || "period"::text || '|' || "marketType" || '|' ||
    COALESCE("participant", '_') || '|' || COALESCE("line", '_');

-- Backfill one source row per existing market (each market has exactly one
-- (oddsSourceId, sourceMarketId) today because the old unique index forbade more).
INSERT INTO "market_source_ids" ("id", "marketId", "oddsSourceId", "sourceMarketId", "settlementRuleId", "createdAt", "updatedAt")
SELECT 'msi_' || "id", "id", "oddsSourceId", "sourceMarketId", "settlementRuleId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "markets";

-- AlterTable: per-selection provenance (nullable first, backfilled, then NOT NULL)
ALTER TABLE "selections" ADD COLUMN "marketSourceId" TEXT;

UPDATE "selections" s
SET "marketSourceId" = msi."id"
FROM "market_source_ids" msi
WHERE msi."marketId" = s."marketId";

ALTER TABLE "markets" ALTER COLUMN "canonicalMarketId" SET NOT NULL;
ALTER TABLE "selections" ALTER COLUMN "marketSourceId" SET NOT NULL;

-- DropIndex
DROP INDEX "markets_oddsSourceId_sourceMarketId_key";

-- CreateIndex
CREATE UNIQUE INDEX "market_source_ids_oddsSourceId_sourceMarketId_key" ON "market_source_ids"("oddsSourceId", "sourceMarketId");
CREATE INDEX "market_source_ids_marketId_idx" ON "market_source_ids"("marketId");
-- Plain (non-unique) index on purpose: uniqueness of a canonical market within an
-- event is enforced by the write path so the reconcile CLI can still repair any
-- legacy duplicate rows a pre-Step-5 deployment left behind.
CREATE INDEX "markets_eventId_canonicalMarketId_idx" ON "markets"("eventId", "canonicalMarketId");

-- AddForeignKey
ALTER TABLE "market_source_ids" ADD CONSTRAINT "market_source_ids_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "market_source_ids" ADD CONSTRAINT "market_source_ids_oddsSourceId_fkey" FOREIGN KEY ("oddsSourceId") REFERENCES "odds_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "market_source_ids" ADD CONSTRAINT "market_source_ids_settlementRuleId_fkey" FOREIGN KEY ("settlementRuleId") REFERENCES "settlement_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selections" ADD CONSTRAINT "selections_marketSourceId_fkey" FOREIGN KEY ("marketSourceId") REFERENCES "market_source_ids"("id") ON DELETE CASCADE ON UPDATE CASCADE;
