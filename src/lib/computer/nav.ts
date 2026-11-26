import { computerEnabledForOrg, computerPanelEnabled, type ComputerFlagEnv } from "@/lib/computer/flag";

export function panelComputerHref(env: ComputerFlagEnv = process.env, organizationId = "") {
  if (!computerPanelEnabled(env) || !computerEnabledForOrg(organizationId, env)) return null;
  return "/panel/computador";
}
