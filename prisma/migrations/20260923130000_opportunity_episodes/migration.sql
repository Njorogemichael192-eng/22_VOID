-- Phase 15: opportunity episodes (historical reconstruction) —
-- group per-detection opportunity snapshots into a stable identity
-- (event + structure + sorted leg selection ids) with first/last seen,
-- detected count and disappearance time.
CREATE TABLE "opportunity_episodes" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "structureType" TEXT NOT NULL,
    "legKey" TEXT NOT NULL,
    "marketStructure" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DETECTED',
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "detectedCount" INTEGER NOT NULL DEFAULT 1,
    "disappearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_episodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opportunity_episodes_eventId_structureType_legKey_key" ON "opportunity_episodes"("eventId", "structureType", "legKey");
CREATE INDEX "opportunity_episodes_lastSeenAt_idx" ON "opportunity_episodes"("lastSeenAt");
CREATE INDEX "opportunity_episodes_disappearedAt_idx" ON "opportunity_episodes"("disappearedAt");

ALTER TABLE "opportunity_episodes"
    ADD CONSTRAINT "opportunity_episodes_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opportunities" ADD COLUMN "episodeId" TEXT;

CREATE INDEX "opportunities_episodeId_idx" ON "opportunities"("episodeId");

ALTER TABLE "opportunities"
    ADD CONSTRAINT "opportunities_episodeId_fkey"
    FOREIGN KEY ("episodeId") REFERENCES "opportunity_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;