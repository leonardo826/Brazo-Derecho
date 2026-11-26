export type ComputerFlagEnv = {
  COMPUTER_FEATURE_ENABLED?: string;
  COMPUTER_ENABLED_ORGS?: string;
  COMPUTER_PANEL?: string;
  NODE_ENV?: string;
};

export function computerFeatureEnabled(env: ComputerFlagEnv = process.env) {
  return env.COMPUTER_FEATURE_ENABLED === "true";
}

/** Ids explícitos. Sin variable, en blanco o solo comas: nadie. */
export function computerEnabledOrgIds(env: ComputerFlagEnv = process.env) {
  const raw = env.COMPUTER_ENABLED_ORGS;
  if (typeof raw !== "string" || !raw.trim()) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

export function computerEnabledForOrg(organizationId: string, env: ComputerFlagEnv = process.env) {
  const id = organizationId.trim();
  if (!computerFeatureEnabled(env) || !id) return false;
  return computerEnabledOrgIds(env).has(id);
}

/** Flag apagado o lista vacía: el computador no existe para nadie. */
export function computerOrgGateClosed(env: ComputerFlagEnv = process.env) {
  return !computerFeatureEnabled(env) || computerEnabledOrgIds(env).size === 0;
}

export function computerUnavailable() {
  return new Response(null, { status: 404 });
}

export function computerPanelEnabled(env: ComputerFlagEnv = process.env) {
  if (!computerFeatureEnabled(env)) return false;
  const raw = env.COMPUTER_PANEL?.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return env.NODE_ENV !== "production";
}
