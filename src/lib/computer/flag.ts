type FlagEnv = {
  COMPUTER_FEATURE_ENABLED?: string;
  COMPUTER_PANEL?: string;
  NODE_ENV?: string;
};

export function computerFeatureEnabled(env: FlagEnv = process.env) {
  return env.COMPUTER_FEATURE_ENABLED === "true";
}

export function computerUnavailable() {
  return new Response(null, { status: 404 });
}

export function computerPanelEnabled(env: FlagEnv = process.env) {
  if (!computerFeatureEnabled(env)) return false;
  const raw = env.COMPUTER_PANEL?.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return env.NODE_ENV !== "production";
}
