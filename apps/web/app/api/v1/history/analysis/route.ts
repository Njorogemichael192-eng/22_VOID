import { falsePositiveAnalysis } from "@/lib/api/handlers/history";
import { serverHistoryDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return falsePositiveAnalysis(request, serverHistoryDeps());
}