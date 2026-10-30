export function clientErrorBody(name: string, message: string) {
  const cleanName = name.replace(/\s+/g, " ").trim().slice(0, 80);
  const cleanMessage = message.replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    source: "cliente" as const,
    name: cleanName || "Error",
    message: cleanMessage || "error",
  };
}
