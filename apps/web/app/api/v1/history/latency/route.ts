import { sourceLatency } from "@/lib/api/handlers/history";
import { serverHistoryDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return sourceLatency(request, serverHistoryDeps());
}