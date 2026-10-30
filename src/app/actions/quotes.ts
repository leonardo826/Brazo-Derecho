"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { agentIsOpen } from "@/lib/agent-access";
import { assertOwnOrganizationActive, guardMutation, guardRate } from "@/lib/guard";
import { buildQuoteLines, matchFreeText, quoteTotal } from "@/lib/agents/quotes";
import { instructionsFor, modelFor } from "@/lib/catalog";
import { callWithinPlan } from "@/lib/plan-limit";
import { prisma } from "@/lib/prisma";
import { USAGE_PRESETS } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { reserveUsage } from "@/lib/usage-store";
import { priceSchema, quoteRequestSchema, quoteStatusSchema, recordIdSchema } from "@/lib/validation";
import { createXaiClient } from "@/lib/xai/client";
import type { XaiResponse } from "@/lib/xai/types";

export async function createPriceAction(formData: FormData) {
  await guardMutation(formData, "/panel/cotizador");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/cotizador");
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
  await guardMutation(formData, "/panel/cotizador");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/cotizador");
  const parsedId = recordIdSchema.safeParse(formData.get("id"));
  if (!parsedId.success) redirect("/panel/cotizador?error=datos");
  const id = parsedId.data;
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
  await guardMutation(formData, "/panel/cotizador");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/cotizador");
  const parsedId = recordIdSchema.safeParse(formData.get("id"));
  if (!parsedId.success) redirect("/panel/cotizador?error=datos");
  const id = parsedId.data;
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
  await guardMutation(formData, "/panel/cotizador");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/cotizador");
  guardRate(`cotizador:${session.organizationId}`, 20, 10 * 60 * 1000, "/panel/cotizador");
  if (!(await agentIsOpen(session.organizationId, "QUOTES")).open) {
    redirect("/panel/cotizador?error=suscripcion");
  }
  const parsed = quoteRequestSchema.safeParse({
    customerName: formData.get("customerName"),
    notes: formData.get("notes") ?? "",
    pedidoLibre: formData.get("pedidoLibre") ?? "",
  });
  if (!parsed.success) redirect("/panel/cotizador?error=datos");
  const customerName = parsed.data.customerName;
  const notes = parsed.data.notes;
  const freeText = parsed.data.pedidoLibre;

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
  let gated: { ok: true; value: XaiResponse } | { ok: false; reason: "limite"; message: string };
  try {
    gated = await callWithinPlan({
      organizationId: session.organizationId,
      checks: [{ agent: "QUOTES", metric: "QUOTES", quantity: 1 }],
      call: () =>
        createXaiClient().respond({
          model: modelFor("QUOTES"),
          instructions: instructionsFor("QUOTES", session.organizationName),
          task: {
            type: "quote_note",
            customerName,
            lineCount: built.lines.length,
            totalClp,
            unmatched: unmatchedNote,
          },
          usage: USAGE_PRESETS.quote,
          businessName: session.organizationName,
          maxOutputTokens: 700,
        }),
    });
  } catch {
    redirect("/panel/cotizador?error=ia");
  }
  if (!gated.ok) redirect("/panel/cotizador?error=limite");
  const response = gated.value;

  let quoteId: string | null = null;
  try {
    quoteId = await prisma.$transaction(async (tx) => {
    const usage = await reserveUsage(tx, {
      organizationId: session.organizationId,
      agent: "QUOTES",
      metric: "QUOTES",
      quantity: 1,
      tokens: response.usage,
      model: response.model,
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
  await guardMutation(formData, "/panel/cotizador");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/cotizador");
  const parsed = quoteStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) redirect("/panel/cotizador?error=datos");
  const id = parsed.data.id;
  const status = parsed.data.status;
  const updated = await prisma.quote.updateMany({
    where: { id, organizationId: session.organizationId },
    data: { status },
  });
  if (updated.count !== 1) redirect("/panel/cotizador?error=noencontrado");
  redirect(`/panel/cotizador/${id}?ok=${status === "APPROVED" ? "aprobada" : "rechazada"}`);
}
