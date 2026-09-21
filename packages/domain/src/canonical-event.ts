import { z } from "zod";

import { EventStatus, eventStatusSchema } from "./value-sets";

export const sourceEventRefSchema = z.object({
  provider: z.string().min(1, "provider is required"),
  sourceEventId: z.string().min(1, "sourceEventId is required"),
});
export type SourceEventRef = z.infer<typeof sourceEventRefSchema>;

export const sourceEventRefsSchema = z
  .array(sourceEventRefSchema)
  .refine(
    (refs) =>
      new Set(refs.map((ref) => `${ref.provider}:${ref.sourceEventId}`)).size === refs.length,
    "sourceEventIds must be unique per provider"
  );

export const canonicalEventSchema = z
  .object({
    canonicalEventId: z.string().min(1, "canonicalEventId is required"),
    sport: z
      .string()
      .regex(/^[a-z0-9_-]+$/, "sport must be a lowercase identifier")
      .default("football"),
    competition: z.string().min(1, "competition is required"),
    homeTeam: z.string().min(1, "homeTeam is required"),
    awayTeam: z.string().min(1, "awayTeam is required"),
    startTime: z.iso.datetime(),
    status: eventStatusSchema.default(EventStatus.SCHEDULED),
    sourceEventIds: sourceEventRefsSchema.default([]),
  })
  .refine((event) => event.homeTeam !== event.awayTeam, "homeTeam and awayTeam must differ");
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
