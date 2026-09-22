import { listOpportunities } from "@/lib/api/handlers/opportunities";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listOpportunities(request, serverHandlerDeps());
}