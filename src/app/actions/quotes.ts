"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { agentIsOpen } from "@/lib/agent-access";
import { buildQuoteLines, matchFreeText, quoteTotal } from "@/lib/agents/quotes";
import { AGENT_CATALOG } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { USAGE_PRESETS } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { reserveUsage } from "@/lib/usage-store";
import { priceSchema } from "@/lib/validation";
import { createXaiClient } from "@/lib/xai/client";

export async function createPriceAction(formData: FormData) {
  const session = await requireSession();
  const parsed = priceSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    unit: formData.get("unit"),
    priceClp: formData.get("priceClp"),
  });
  if (!parsed.success) redirect("/panel/cotizador?error=datos");
  const count = await prisma.priceItem.count({ where: { organizationId: session.organizationId } });
  if (count >= 500) redirect("/panel/cotizador?error=cupo");
  try {
    await prisma.priceItem.create({
      data: {
        organizationId: session.organizationId,
        sku: parsed.data.sku,
        name: parsed.data.name,
        unit: parsed.data.unit,
        priceClp: parsed.data.priceClp,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect("/panel/cotizador?error=sku");
    }
    throw error;
  }
  redirect("/panel/cotizador?ok=precio");
}

export async function updatePriceAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const parsed = priceSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    unit: formData.get("unit"),
    priceClp: formData.get("priceClp"),
  });
  if (!parsed.success) redirect("/panel/cotizador?error=datos");
  try {
    const updated = await prisma.priceItem.updateMany({
      where: { id, organizationId: session.organizationId },
      data: {
        sku: parsed.data.sku,
        name: parsed.data.name,
        unit: parsed.data.unit,
        priceClp: parsed.data.priceClp,
      },
    });
    if (updated.count !== 1) redirect("/panel/cotizador?error=noencontrado");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect("/panel/cotizador?error=sku");
    }
    throw error;
  }
  redirect("/panel/cotizador?ok=precio");
}

export async function togglePriceAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const item = await prisma.priceItem.findFirst({
    where: { id, organizationId: session.organizationId },
  });
  if (!item) redirect("/panel/cotizador?error=noencontrado");
  await prisma.priceItem.update({
    where: { id: item.id },
    data: { active: !item.active },
  });
  redirect("/panel/cotizador?ok=precio");
}

export async function createQuoteAction(formData: FormData) {
  const session = await requireSession();
  if (!(await agentIsOpen(session.organizationId, "QUOTES")).open) {
    redirect("/panel/cotizador?error=suscripcion");
  }
  const customerName = String(formData.get("customerName") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const freeText = String(formData.get("pedidoLibre") ?? "");
  if (customerName.length < 2 || customerName.length > 120 || notes.length > 1000) {
    redirect("/panel/cotizador?error=datos");
  }

  const ids = formData.getAll("priceItemId").map(String);
  const quantities = formData.getAll("quantity").map((value) => Number(value));
  const requested = ids
    .map((priceItemId, index) => ({ priceItemId, quantity: quantities[index] }))
    .filter((row) => row.priceItemId);

  const catalog = await prisma.priceItem.findMany({
    where: { organizationId: session.organizationId },
  });
  const built = buildQuoteLines([...requested, ...matchFreeText(freeText, catalog)], catalog);
  if (built.lines.length === 0) {
    redirect(`/panel/cotizador?error=${built.rejected > 0 ? "catalogo" : "vacio"}`);
  }
  if (built.lines.length > 30) redirect("/panel/cotizador?error=datos");

  const totalClp = quoteTotal(built.lines);
  const unmatchedNote =
    built.rejected > 0
      ? `${built.rejected} línea(s) no estaban en la lista activa y no se incluyeron. No inventamos el precio.`
      : "";
  const response = await createXaiClient().respond({
    model: AGENT_CATALOG.QUOTES.model,
    instructions: AGENT_CATALOG.QUOTES.instructions,
    task: {
      type: "quote_note",
      customerName,
      lineCount: built.lines.length,
      totalClp,
      unmatched: unmatchedNote,
    },
    usage: USAGE_PRESETS.quote,
  });

  let quoteId: string | null = null;
  try {
    quoteId = await prisma.$transaction(async (tx) => {
    const usage = await reserveUsage(tx, {
      organizationId: session.organizationId,
      agent: "QUOTES",
      metric: "QUOTES",
      quantity: 1,
      tokens: response.usage,
    });
    if (!usage.ok) return null;
    const aggregate = await tx.quote.aggregate({
      where: { organizationId: session.organizationId },
      _max: { number: true },
    });
    const quote = await tx.quote.create({
      data: {
        organizationId: session.organizationId,
        number: (aggregate._max.number ?? 0) + 1,
        customerName,
        notes,
        agentNote: response.outputText,
        unmatchedNote,
        status: "PENDING_APPROVAL",
        totalClp,
        lines: {
          create: built.lines.map((line) => ({
            priceItemId: line.priceItemId,
            description: line.description,
            unit: line.unit,
            quantity: line.quantity,
            unitPriceClp: line.unitPriceClp,
          })),
        },
      },
    });
    return quote.id;
  });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect("/panel/cotizador?error=datos");
    }
    throw error;
  }

  if (!quoteId) redirect("/panel/cotizador?error=limite");
  redirect(`/panel/cotizador/${quoteId}?ok=cotizacion`);
}

export async function setQuoteStatusAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (status !== "APPROVED" && status !== "REJECTED") {
    redirect(`/panel/cotizador/${id}?error=datos`);
  }
  const updated = await prisma.quote.updateMany({
    where: { id, organizationId: session.organizationId },
    data: { status },
  });
  if (updated.count !== 1) redirect("/panel/cotizador?error=noencontrado");
  redirect(`/panel/cotizador/${id}?ok=${status === "APPROVED" ? "aprobada" : "rechazada"}`);
}
