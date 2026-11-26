import { timingSafeEqual } from "node:crypto";
import { computerEnabledOrgIds, computerOrgGateClosed } from "@/lib/computer/flag";
import { reapIdleComputers } from "@/lib/computer/power";

function authorized(request: Request, secret: string) {
  const got = request.headers.get("authorization") ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  const left = Buffer.from(got);
  const right = Buffer.from(expected);
  if (!secret || left.length === 0 || left.length !== right.length) {
    timingSafeEqual(Buffer.from("no"), Buffer.from("no"));
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function idleCronResponse(
  request: Request,
  deps: {
    env?: { CRON_SECRET?: string; COMPUTER_FEATURE_ENABLED?: string; COMPUTER_ENABLED_ORGS?: string };
    reap?: () => Promise<{ stopped: string[]; skippedBusy: string[] }>;
  } = {},
) {
  const env = deps.env ?? process.env;
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (!authorized(request, secret)) return Response.json({ ok: false }, { status: 401 });
  if (computerOrgGateClosed(env)) return Response.json({ ok: true, stopped: 0, busy: 0 });
  const allowed = computerEnabledOrgIds(env);
  const result = await (deps.reap ?? (() => reapIdleComputers({ allowOrganizationIds: allowed })))();
  return Response.json({ ok: true, stopped: result.stopped.length, busy: result.skippedBusy.length });
}
