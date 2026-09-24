import { getEpisodeReconstruction } from "@/lib/api/handlers/history";
import { serverHistoryDeps } from "@/lib/api/runtime";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getEpisodeReconstruction(request, serverHistoryDeps(), id);
}