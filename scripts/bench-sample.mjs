/** Una muestra completa exige el id guardado. El cambio de DOM, solo, no alcanza. */
export function classifyTurn(turn) {
  if (!turn?.click) {
    return { completo: false, domListo: false, motivo: "sin-clic" };
  }
  const rel = (value) => (typeof value === "number" ? Math.round(value - turn.click) : null);
  const ackHttp = rel(turn.ackHttp);
  const sseByte = rel(turn.sseByte);
  const domCambio = rel(turn.domUtil);
  const servidorMensaje = rel(turn.sseMessage);
  const servidorHecho = rel(turn.sseDone);
  const domId = rel(turn.domId);
  const domEstado = rel(turn.domEstado);
  const domListo =
    ackHttp != null &&
    sseByte != null &&
    domCambio != null &&
    ackHttp >= 0 &&
    sseByte >= ackHttp &&
    domCambio >= sseByte;
  const id = typeof turn.messageId === "string" && turn.messageId.length > 0;
  const completo =
    domListo &&
    id &&
    servidorMensaje != null &&
    servidorHecho != null &&
    domId != null &&
    servidorMensaje >= ackHttp &&
    servidorHecho >= servidorMensaje &&
    domId >= servidorMensaje;
  return {
    completo,
    domListo,
    motivo: completo ? "ok" : domListo ? "sin-id-persistido" : "secuencia-o-muestra-incompleta",
    ackHttp,
    sseByte,
    domEstado,
    domCambio,
    servidorMensaje,
    servidorHecho,
    domId,
  };
}
