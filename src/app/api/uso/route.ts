import { companyMeter } from "@/lib/meter-store";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await resolveSession();
  if (!session) {
    return Response.json({ error: "sesion" }, { status: 401 });
  }
  const meter = await companyMeter(session.organizationId);
  return Response.json({
    empresaId: session.organizationId,
    mes: meter.yearMonth,
    etiqueta: meter.label,
    tareas: meter.tasks,
    tokens: {
      entrada: meter.tokens.inputTokens,
      cache: meter.tokens.cachedTokens,
      salida: meter.tokens.outputTokens,
    },
    tokensApi: {
      entrada: meter.apiTokens.inputTokens,
      cache: meter.apiTokens.cachedTokens,
      salida: meter.apiTokens.outputTokens,
    },
    tokensSimulador: {
      entrada: meter.simulatorTokens.inputTokens,
      cache: meter.simulatorTokens.cachedTokens,
      salida: meter.simulatorTokens.outputTokens,
    },
    costoRealUsd: meter.realUsd,
    costoXaiUsd: meter.xaiUsd,
    costoComputadorUsd: meter.computerUsd,
    precioClienteClp: meter.clientClp,
    precioFijoClp: meter.fixedPriceClp,
    estimado: true,
    nota: "Estimado. No es un cobro. El precio al cliente es el doble del costo real y no cambia el monto de Mercado Pago.",
  });
}
