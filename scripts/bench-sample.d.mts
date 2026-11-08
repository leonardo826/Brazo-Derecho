export function classifyTurn(turn: {
  click?: number;
  ackHttp?: number | null;
  sseByte?: number | null;
  domUtil?: number | null;
  domEstado?: number | null;
  sseMessage?: number | null;
  sseDone?: number | null;
  messageId?: string | null;
  domId?: number | null;
}): {
  completo: boolean;
  domListo: boolean;
  motivo: string;
  ackHttp: number | null;
  sseByte: number | null;
  domEstado: number | null;
  domCambio: number | null;
  servidorMensaje: number | null;
  servidorHecho: number | null;
  domId: number | null;
};
