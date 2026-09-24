/**
 * History endpoints (Phase 15): GET /api/v1/history/opportunities,
 * /api/v1/history/opportunities/:id, /api/v1/history/odds,
 * /api/v1/history/latency and /api/v1/history/analysis.
 *
 * These expose the reconstruction layer: opportunity episodes (legs grouped by
 * their deterministic identity with first/last seen, duration and
 * disappearance), the per-leg price series, poll-to-persist source latency and
 * the false-positive analysis over concluded episodes. `eventId` here is the
 * canonical event id — the identity episodes and history carry.
 */

import { guardRequest, type SecurityDeps } from "../../security/guard";
import { badRequest, jsonError, jsonOk } from "../http";
import {
  episodeHistoryQuerySchema,
  falsePositiveQuerySchema,
  idSchema,
  oddsHistoryQuerySchema,
  parseQuery,
  sourceLatencyQuerySchema,
  toEpisodeHistoryFilter,
  toFalsePositiveFilter,
  toOddsHistoryFilter,
  toSourceLatencyFilter,
} from "../schema";
import type { ApiAuthEnv } from "../auth";
import type { HistoryRepo } from "@22void/db";

export interface HistoryHandlerDeps {
  repo: HistoryRepo;
  env: ApiAuthEnv;
  now?: () => number;
  /** Phase 16 request-guard options (rate limit / audit). */
  security?: SecurityDeps;
}

async function authorize(
  request: Request,
  deps: HistoryHandlerDeps,
  required: "reader" | "admin" = "reader",
) {
  return guardRequest(request, deps, required);
}

export async function listEpisodes(request: Request, deps: HistoryHandlerDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, episodeHistoryQuerySchema);
  if (!parsed.ok) return parsed.response;

  const episodes = await deps.repo.listEpisodes(toEpisodeHistoryFilter(parsed.query));
  return jsonOk({ data: episodes });
}

export async function getEpisodeReconstruction(
  request: Request,
  deps: HistoryHandlerDeps,
  idParam: string,
): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  if (!idSchema.safeParse(idParam).success) {
    return jsonError("BAD_REQUEST", `Invalid episode id "${idParam}".`, 400);
  }
  const reconstruction = await deps.repo.getEpisodeReconstruction(idParam);
  if (!reconstruction) {
    return jsonError("NOT_FOUND", `Episode ${idParam} not found.`, 404);
  }
  return jsonOk({ data: reconstruction });
}

export async function listOddsHistory(request: Request, deps: HistoryHandlerDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, oddsHistoryQuerySchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.query.selectionId === undefined && parsed.query.eventId === undefined) {
    return badRequest(
      "Odds history requires a selectionId or an eventId (canonical event id).",
      "Pass either selectionId=<selection id> or eventId=<canonical event id>.",
    );
  }

  const history = await deps.repo.listOddsHistory(toOddsHistoryFilter(parsed.query));
  return jsonOk({ data: history });
}

export async function sourceLatency(request: Request, deps: HistoryHandlerDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, sourceLatencyQuerySchema);
  if (!parsed.ok) return parsed.response;

  const stats = await deps.repo.sourceLatency(toSourceLatencyFilter(parsed.query));
  return jsonOk({ data: stats });
}

export async function falsePositiveAnalysis(
  request: Request,
  deps: HistoryHandlerDeps,
): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, falsePositiveQuerySchema);
  if (!parsed.ok) return parsed.response;

  const report = await deps.repo.falsePositiveAnalysis(toFalsePositiveFilter(parsed.query));
  return jsonOk({ data: report });
}