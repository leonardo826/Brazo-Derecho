export function computerPanelEnabled(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.COMPUTER_PANEL?.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return env.NODE_ENV !== "production";
}
