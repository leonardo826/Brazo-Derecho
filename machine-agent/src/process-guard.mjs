function safeProcessLog(tipo, error) {
  const record = error && typeof error === "object" ? error : {};
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : "";
  process.stderr.write(`${JSON.stringify({ evento: "proceso", tipo, name, code })}\n`);
}

export function installProcessGuards() {
  process.on("uncaughtException", (error) => {
    safeProcessLog("uncaughtException", error);
  });
  process.on("unhandledRejection", (error) => {
    safeProcessLog("unhandledRejection", error);
  });
}
