import { getOpportunity } from "@/lib/api/handlers/opportunities";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return getOpportunity(request, serverHandlerDeps(), id);
}