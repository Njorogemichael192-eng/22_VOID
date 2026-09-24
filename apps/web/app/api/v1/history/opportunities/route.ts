import { listEpisodes } from "@/lib/api/handlers/history";
import { serverHistoryDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listEpisodes(request, serverHistoryDeps());
}