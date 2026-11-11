import { computerFeatureEnabled, computerUnavailable } from "@/lib/computer/flag";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!computerFeatureEnabled() || request.method !== "POST") return computerUnavailable();
  return computerUnavailable();
}
