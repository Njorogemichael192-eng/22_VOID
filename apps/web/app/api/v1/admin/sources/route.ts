import { listAdminSources } from "@/lib/api/handlers/admin";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listAdminSources(request, serverHandlerDeps());
}