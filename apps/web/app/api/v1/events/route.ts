import { listEvents } from "@/lib/api/handlers/events";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request) {
  return listEvents(request, serverHandlerDeps());
}