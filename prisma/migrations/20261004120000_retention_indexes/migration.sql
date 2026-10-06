-- Phase 19 Step 1: single-column time indexes for retention pruning.
--
-- raw_payloads, scanner_health and odds_observations only had composite indexes
-- whose leading column is not the timestamp (oddsSourceId / selectionId), so a
-- global "older than this cutoff" DELETE has no usable leading column and falls
-- back to a sequential scan on tables that reach hundreds of MB. audit_logs
-- already had @@index([createdAt]) and needs nothing here.
--
-- Plain CREATE INDEX (not CONCURRENTLY) on purpose: the `migrate` service
-- gates web/worker via `service_completed_successfully`, so there are no
-- concurrent writers at migration time and the brief lock is harmless.
CREATE INDEX "raw_payloads_receivedAt_idx" ON "raw_payloads" ("receivedAt");
CREATE INDEX "scanner_health_startedAt_idx" ON "scanner_health" ("startedAt");
CREATE INDEX "odds_observations_observedAt_idx" ON "odds_observations" ("observedAt");