import { jsonOk } from "@/lib/api/http";
import { openApiDocument } from "@/lib/api/openapi";

export async function GET() {
  return jsonOk(openApiDocument);
}