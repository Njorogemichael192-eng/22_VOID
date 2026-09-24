-- Phase 14: event-normalization confidence on source event bindings.
ALTER TABLE "source_event_ids" ADD COLUMN "eventConfidence" DOUBLE PRECISION;