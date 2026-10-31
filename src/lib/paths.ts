export function safePanelPath(value: string | null | undefined) {
  if (!value) return "/panel";
  if (!value.startsWith("/panel")) return "/panel";
  if (value.startsWith("//") || value.includes("\\") || value.includes("..")) return "/panel";
  if (!/^\/panel(\/[A-Za-z0-9\-._~%]*)*$/.test(value)) return "/panel";
  return value;
}

export function paymentReturnPath(value: string | null | undefined) {
  const path = safePanelPath(value);
  if (path === "/panel/pago") return "/panel";
  return path;
}

export function panelReturnPath(referer: string | null | undefined) {
  if (!referer) return "/panel";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "/panel";
  }
  const path = safePanelPath(url.pathname);
  if (path !== "/panel/empezar") return path;
  const params = new URLSearchParams();
  const paso = url.searchParams.get("paso");
  if (paso === "empresa" || paso === "agente" || paso === "probar") params.set("paso", paso);
  const agente = url.searchParams.get("agente");
  if (agente === "WHATSAPP" || agente === "QUOTES" || agente === "MARKETING") params.set("agente", agente);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
