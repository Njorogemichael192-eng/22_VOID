import { listMarkets } from "@/lib/api/handlers/markets";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listMarkets(request, serverHandlerDeps());
}