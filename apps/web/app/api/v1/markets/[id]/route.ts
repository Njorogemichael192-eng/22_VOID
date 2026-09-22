import { getMarket } from "@/lib/api/handlers/markets";
import { serverHandlerDeps } from "@/lib/api/runtime";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return getMarket(request, serverHandlerDeps(), id);
}