import { getEvent } from "@/lib/api/handlers/events";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return getEvent(request, serverHandlerDeps(), id);
}