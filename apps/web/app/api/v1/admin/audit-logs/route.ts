import { listAuditLogs } from "@/lib/api/handlers/admin";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listAuditLogs(request, serverHandlerDeps());
}