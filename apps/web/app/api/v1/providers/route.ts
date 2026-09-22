import { listProviders } from "@/lib/api/handlers/system";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listProviders(request, serverHandlerDeps());
}