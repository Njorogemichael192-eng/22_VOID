import { listOdds } from "@/lib/api/handlers/markets";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listOdds(request, serverHandlerDeps());
}