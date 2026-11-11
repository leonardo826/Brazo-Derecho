import { computerFeatureEnabled, computerUnavailable } from "@/lib/computer/flag";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!computerFeatureEnabled()) return computerUnavailable();
  return computerUnavailable();
}
