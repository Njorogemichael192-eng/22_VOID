import { health } from "@/lib/api/handlers/system";

export async function GET() {
  return health();
}