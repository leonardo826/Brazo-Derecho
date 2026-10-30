export function safePanelPath(value: string | null | undefined) {
  if (!value) return "/panel";
  if (!value.startsWith("/panel")) return "/panel";
  if (value.startsWith("//") || value.includes("\\") || value.includes("..")) return "/panel";
  if (!/^\/panel(\/[A-Za-z0-9\-._~%]*)*$/.test(value)) return "/panel";
  return value;
}
