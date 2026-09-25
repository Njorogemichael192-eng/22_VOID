import { ready } from "@/lib/api/handlers/system";

export async function GET() {
  return ready();
}
