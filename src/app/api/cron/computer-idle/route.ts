import { idleCronResponse } from "@/lib/computer/idle-cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return idleCronResponse(request);
}

export async function POST(request: Request) {
  return idleCronResponse(request);
}
