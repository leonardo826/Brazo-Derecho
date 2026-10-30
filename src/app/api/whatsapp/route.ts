import { Prisma } from "@prisma/client";
import { withAssistantDisclosure } from "@/lib/agents/whatsapp";
import { runWhatsappTurn } from "@/lib/agents/run-whatsapp";
import { whatsappEnv } from "@/lib/env";
import { logEvent } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import { dayStart } from "@/lib/usage";
import { parseInboundTexts, routeInbound, verifyMetaSignature, verifyWebhookChallenge } from "@/lib/whatsapp/cloud";
import { sendWhatsappText } from "@/lib/whatsapp/send";

export const dynamic = "force-dynamic";

const CLOSED = "Ahora no podemos atender por este canal. Si es urgente, escríbele directo al local.";
const LIMITED = "Llegamos al cupo de respuestas de este mes. Una persona del equipo puede seguir la conversación.";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const env = whatsappEnv();
  const result = verifyWebhookChallenge({
    mode: url.searchParams.get("hub.mode"),
    verifyToken: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
    expectedToken: env.verifyToken || null,
  });
  logEvent("whatsapp.webhook", { method: "GET", status: result.ok ? 200 : result.status });
  if (!result.ok) return new Response(null, { status: result.status });
  return new Response(result.challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function saveCanned(input: {
  conversationId: string;
  question: string;
  externalId: string;
  businessName: string;
  body: string;
}) {
  const priorToday = await prisma.message.count({
    where: { conversationId: input.conversationId, role: "AGENT", createdAt: { gte: dayStart() } },
  });
  const text = withAssistantDisclosure(input.body, input.businessName, priorToday === 0);
  try {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: "CUSTOMER",
        body: input.question,
        externalId: input.externalId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return text;
    throw error;
  }
  await prisma.message.create({
    data: { conversationId: input.conversationId, role: "AGENT", body: text },
  });
  return text;
}

export async function POST(request: Request) {
  try {
    return await handleWhatsappPost(request);
  } catch (error) {
    captureException(error, { source: "whatsapp.webhook" });
    return Response.json({ ok: false }, { status: 500 });
  }
}

async function handleWhatsappPost(request: Request) {
  const env = whatsappEnv();
  if (!env.appSecret) {
    logEvent("whatsapp.webhook", { method: "POST", status: 503, reason: "sin_secreto" });
    return Response.json({ ok: false, error: "Falta WHATSAPP_APP_SECRET" }, { status: 503 });
  }
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env.appSecret)) {
    logEvent("whatsapp.webhook", { method: "POST", status: 401, reason: "firma" });
    return Response.json({ ok: false }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    logEvent("whatsapp.webhook", { method: "POST", status: 400, reason: "json" });
    return Response.json({ ok: false }, { status: 400 });
  }

  const inbound = parseInboundTexts(payload);
  if (inbound.length === 0) {
    logEvent("whatsapp.webhook", { method: "POST", status: 200, inbound: 0 });
    return Response.json({ ok: true });
  }

  const phoneIds = [...new Set(inbound.map((item) => item.phoneNumberId))];
  const owners = await prisma.organization.findMany({
    where: { whatsappPhoneNumberId: { in: phoneIds } },
    select: { id: true, name: true, whatsappPhoneNumberId: true },
  });

  let retry = false;
  for (const message of inbound) {
    const routed = routeInbound(message, owners);
    if (!routed) continue;
    const organization = owners.find((item) => item.id === routed.organizationId);
    if (!organization) continue;

    const externalId = `wa:${message.from}`;
    let conversation = await prisma.conversation.findUnique({
      where: { organizationId_externalId: { organizationId: organization.id, externalId } },
    });
    if (!conversation) {
      const label = (message.name || `+${message.from}`).slice(0, 80);
      try {
        conversation = await prisma.conversation.create({
          data: {
            organizationId: organization.id,
            customerLabel: label.length >= 2 ? label : `+${message.from}`,
            externalId,
            channel: "whatsapp",
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        conversation = await prisma.conversation.findUnique({
          where: { organizationId_externalId: { organizationId: organization.id, externalId } },
        });
      }
    }
    if (!conversation) continue;

    const turn = await runWhatsappTurn({
      organizationId: organization.id,
      organizationName: organization.name,
      conversationId: conversation.id,
      question: message.body,
      inboundExternalId: message.messageId,
    });

    if (!turn.ok && turn.reason === "ia") {
      retry = true;
      continue;
    }

    let outgoing = "";
    if (!turn.ok && (turn.reason === "suscripcion" || turn.reason === "limite" || turn.reason === "suspendida")) {
      outgoing = await saveCanned({
        conversationId: conversation.id,
        question: message.body,
        externalId: message.messageId,
        businessName: organization.name,
        body: turn.reason === "limite" ? LIMITED : CLOSED,
      });
    } else if (turn.ok && !turn.duplicate) {
      outgoing = turn.text;
    }

    if (outgoing) {
      await sendWhatsappText(message.phoneNumberId, message.from, outgoing);
    }
  }

  const status = retry ? 500 : 200;
  logEvent("whatsapp.webhook", {
    method: "POST",
    status,
    inbound: inbound.length,
    organizations: owners.length,
  });
  if (retry) return Response.json({ ok: false }, { status: 500 });
  return Response.json({ ok: true });
}
