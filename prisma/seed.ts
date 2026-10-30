import { PrismaClient, type AgentKind } from "@prisma/client";
import { channelFor, draftImageSvg, toMarketingRecord } from "../src/lib/agents/marketing";
import { buildQuoteLines, matchFreeText, quoteTotal } from "../src/lib/agents/quotes";
import { decideWhatsappReply, withAssistantDisclosure } from "../src/lib/agents/whatsapp";
import { AGENT_CATALOG } from "../src/lib/catalog";
import { hashPassword } from "../src/lib/password";
import { USAGE_PRESETS } from "../src/lib/pricing";
import { trialEnd } from "../src/lib/subscription";
import { MockXaiClient } from "../src/lib/xai/mock";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "Clave-demo-2026";
const AGENTS = ["WHATSAPP", "QUOTES", "MARKETING"] as const satisfies readonly AgentKind[];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO !== "1") {
    throw new Error("El seed de demostración no corre en producción. Define SEED_DEMO=1 si de verdad quieres cargarlo.");
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const client = new MockXaiClient();
  await seedFerreteria(passwordHash, client);
  await seedCafe(passwordHash, client);
  console.log("Empresas de demostración listas. El seed se puede correr de nuevo sin duplicar datos.");
  console.log("maria@losaromos.cl / Clave-demo-2026  ·  Ferretería Los Aromos");
  console.log("pedro@cafedelpuerto.cl / Clave-demo-2026  ·  Café del Puerto");
}

async function seedFerreteria(passwordHash: string, client: MockXaiClient) {
  const organizationId = await ensureOwner({
    email: "maria@losaromos.cl",
    person: "María Soto",
    organization: "Ferretería Los Aromos",
    slug: "ferreteria-los-aromos",
    rut: "76.123.456-0",
    passwordHash,
  });
  const knowledge = [
    {
      title: "Horario de atención",
      body: "Abrimos de lunes a viernes de 9:00 a 19:00 y los sábados de 9:00 a 14:00. Los domingos estamos cerrados.",
    },
    {
      title: "Dirección del local",
      body: "Estamos en Avenida Matta 1234, Santiago. Hay estacionamiento en la calle.",
    },
    {
      title: "Despacho",
      body: "Hacemos despacho dentro de Santiago en 24 a 48 horas hábiles. El costo lo confirma una persona del equipo.",
    },
    {
      title: "Medios de pago",
      body: "En tienda aceptamos efectivo, débito y crédito. Este chat no recibe pagos ni pide datos de tarjeta.",
    },
  ];
  await ensureKnowledge(organizationId, knowledge);
  await ensureConversation({
    organizationId,
    businessName: "Ferretería Los Aromos",
    externalId: "demo:horario",
    customerLabel: "Cliente del mesón",
    question: "¿A qué hora abren el sábado?",
    knowledge,
    client,
  });
  await ensureConversation({
    organizationId,
    businessName: "Ferretería Los Aromos",
    externalId: "demo:despacho",
    customerLabel: "Vecino de Ñuñoa",
    question: "¿Hacen despacho dentro de Santiago?",
    knowledge,
    client,
  });
  await ensureConversation({
    organizationId,
    businessName: "Ferretería Los Aromos",
    externalId: "demo:descuento",
    customerLabel: "Maestro José",
    question: "¿Me pueden hacer un descuento por llevar dos galones?",
    knowledge,
    client,
  });

  const pintura = await ensurePrice(organizationId, {
    sku: "PIN-1G",
    name: "Pintura látex blanco 1 galón",
    unit: "galón",
    priceClp: 18990,
  });
  const taladro = await ensurePrice(organizationId, {
    sku: "TAL-650",
    name: "Taladro percutor 650 W",
    unit: "unidad",
    priceClp: 59990,
  });
  await ensurePrice(organizationId, {
    sku: "TOR-14",
    name: "Tornillo hexagonal 1/4 x 1",
    unit: "unidad",
    priceClp: 120,
  });
  const candado = await ensurePrice(organizationId, {
    sku: "CAN-40",
    name: "Candado 40 mm",
    unit: "unidad",
    priceClp: 4590,
  });

  await ensureQuote({
    organizationId,
    number: 1,
    customerName: "Maestranza Los Robles",
    notes: "Obra en Ñuñoa. Retiran el viernes.",
    request: "2 galones de pintura látex blanco y 1 taladro percutor",
    catalog: [pintura, taladro],
    status: "PENDING_APPROVAL",
    client,
  });
  await ensureQuote({
    organizationId,
    number: 2,
    customerName: "Taller Ñuñoa",
    notes: "Pasan a retirar el lunes en la mañana.",
    request: "4 candados",
    catalog: [candado],
    status: "APPROVED",
    client,
  });

  const brand = {
    voice: "cercana y clara, sin tecnicismos",
    audience: "dueños de casa y maestros en Santiago",
    summary: "Ferretería de barrio con despacho dentro de Santiago.",
  };
  await ensureBrand(organizationId, brand);
  await ensureMarketingPost({ organizationId, ...brand, index: 0, client });
}

async function seedCafe(passwordHash: string, client: MockXaiClient) {
  const organizationId = await ensureOwner({
    email: "pedro@cafedelpuerto.cl",
    person: "Pedro Rojas",
    organization: "Café del Puerto",
    slug: "cafe-del-puerto",
    rut: "76.543.210-3",
    passwordHash,
  });
  const knowledge = [
    {
      title: "Horario de atención",
      body: "Abrimos todos los días de 8:30 a 20:00, también festivos.",
    },
    {
      title: "Dirección del local",
      body: "Estamos en Calle Cochrane 250, Valparaíso, a una cuadra del puerto.",
    },
    {
      title: "Carta del día",
      body: "El menú del día incluye plato de fondo y bebestible. El precio se paga en el local; este chat no cobra.",
    },
  ];
  await ensureKnowledge(organizationId, knowledge);
  await ensureConversation({
    organizationId,
    businessName: "Café del Puerto",
    externalId: "demo:domingo",
    customerLabel: "Vecina del cerro",
    question: "¿A qué hora abren el domingo?",
    knowledge,
    client,
  });
  await ensureConversation({
    organizationId,
    businessName: "Café del Puerto",
    externalId: "demo:carta",
    customerLabel: "Cliente de la terraza",
    question: "¿Tienen carta del día?",
    knowledge,
    client,
  });

  const espresso = await ensurePrice(organizationId, {
    sku: "ESP-01",
    name: "Espresso doble",
    unit: "taza",
    priceClp: 2500,
  });
  const grano = await ensurePrice(organizationId, {
    sku: "CAF-01",
    name: "Café de grano 250 g",
    unit: "bolsa",
    priceClp: 8990,
  });
  const queque = await ensurePrice(organizationId, {
    sku: "QUE-01",
    name: "Queque de naranja",
    unit: "porción",
    priceClp: 3200,
  });
  await ensureQuote({
    organizationId,
    number: 1,
    customerName: "Oficina del puerto",
    notes: "Lo retiran hoy después de las 16:00.",
    request: "2 espresso doble y 1 queque de naranja",
    catalog: [espresso, grano, queque],
    status: "PENDING_APPROVAL",
    client,
  });

  const brand = {
    voice: "cálida y breve",
    audience: "vecinos de Valparaíso que pasan por el puerto",
    summary: "Café de especialidad con queque de naranja y grano tostado en casa.",
  };
  await ensureBrand(organizationId, brand);
  await ensureMarketingPost({ organizationId, ...brand, index: 0, client });
}

async function ensureOwner(input: {
  email: string;
  person: string;
  organization: string;
  slug: string;
  rut: string;
  passwordHash: string;
}) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash: input.passwordHash,
        consentAt: existing.consentAt ?? new Date(),
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      },
    });
    const organizationId = existing.memberships[0]?.organizationId;
    if (!organizationId) {
      throw new Error(`La cuenta de demostración ${input.email} no tiene empresa.`);
    }
    await ensureTrials(organizationId);
    return organizationId;
  }

  const now = new Date();
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.person,
      passwordHash: input.passwordHash,
      consentAt: now,
      emailVerifiedAt: now,
      memberships: {
        create: {
          role: "OWNER",
          organization: {
            create: {
              name: input.organization,
              slug: input.slug,
              rut: input.rut,
            },
          },
        },
      },
    },
    include: { memberships: true },
  });
  const organizationId = user.memberships[0].organizationId;
  await ensureTrials(organizationId);
  return organizationId;
}

async function ensureTrials(organizationId: string) {
  const now = new Date();
  for (const agent of AGENTS) {
    const current = await prisma.subscription.findUnique({
      where: { organizationId_agent: { organizationId, agent } },
    });
    if (current?.status === "ACTIVE") continue;
    await prisma.subscription.upsert({
      where: { organizationId_agent: { organizationId, agent } },
      create: {
        organizationId,
        agent,
        status: "TRIAL",
        periodStart: now,
        periodEnd: trialEnd(now),
      },
      update: {
        status: "TRIAL",
        periodStart: now,
        periodEnd: trialEnd(now),
      },
    });
  }
}

async function ensureKnowledge(organizationId: string, items: { title: string; body: string }[]) {
  for (const item of items) {
    const found = await prisma.knowledgeItem.findFirst({
      where: { organizationId, title: item.title },
      select: { id: true },
    });
    if (found) continue;
    await prisma.knowledgeItem.create({ data: { organizationId, ...item } });
  }
}

async function ensurePrice(
  organizationId: string,
  item: { sku: string; name: string; unit: string; priceClp: number },
) {
  return prisma.priceItem.upsert({
    where: { organizationId_sku: { organizationId, sku: item.sku } },
    create: { organizationId, ...item },
    update: {},
  });
}

async function ensureConversation(input: {
  organizationId: string;
  businessName: string;
  externalId: string;
  customerLabel: string;
  question: string;
  knowledge: { title: string; body: string }[];
  client: MockXaiClient;
}) {
  const existing = await prisma.conversation.findUnique({
    where: {
      organizationId_externalId: { organizationId: input.organizationId, externalId: input.externalId },
    },
    select: { id: true },
  });
  if (existing) return;

  const knowledge = input.knowledge.map((item, index) => ({ id: String(index), ...item }));
  const decision = decideWhatsappReply(input.question, knowledge);
  const task =
    decision.kind === "refuse"
      ? { type: "whatsapp_refuse" as const, reply: decision.reply }
      : decision.kind === "answer"
        ? { type: "whatsapp_answer" as const, title: decision.item.title, body: decision.item.body }
        : { type: "whatsapp_escalate" as const };
  const response = await input.client.respond({
    model: AGENT_CATALOG.WHATSAPP.model,
    instructions: AGENT_CATALOG.WHATSAPP.instructions,
    task,
    usage: USAGE_PRESETS.whatsapp,
  });
  const started = new Date();
  await prisma.conversation.create({
    data: {
      organizationId: input.organizationId,
      customerLabel: input.customerLabel,
      externalId: input.externalId,
      channel: "simulator",
      messages: {
        create: [
          { role: "CUSTOMER", body: input.question, createdAt: started },
          {
            role: "AGENT",
            body: withAssistantDisclosure(response.outputText, input.businessName, true),
            refused: decision.kind === "refuse",
            escalated: decision.kind === "escalate",
            createdAt: new Date(started.getTime() + 1000),
          },
        ],
      },
    },
  });
  await prisma.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      agent: "WHATSAPP",
      metric: "RESPONSES",
      quantity: 1,
      model: AGENT_CATALOG.WHATSAPP.model,
      ...USAGE_PRESETS.whatsapp,
    },
  });
}

async function ensureQuote(input: {
  organizationId: string;
  number: number;
  customerName: string;
  notes: string;
  request: string;
  catalog: { id: string; sku: string; name: string; unit: string; priceClp: number; active: boolean }[];
  status: "PENDING_APPROVAL" | "APPROVED";
  client: MockXaiClient;
}) {
  const existing = await prisma.quote.findUnique({
    where: { organizationId_number: { organizationId: input.organizationId, number: input.number } },
    select: { id: true },
  });
  if (existing) return;

  const built = buildQuoteLines(matchFreeText(input.request, input.catalog), input.catalog);
  if (built.lines.length === 0) {
    throw new Error(`El seed no pudo armar la cotización ${input.number} para ${input.customerName}.`);
  }
  const totalClp = quoteTotal(built.lines);
  const note = await input.client.respond({
    model: AGENT_CATALOG.QUOTES.model,
    instructions: AGENT_CATALOG.QUOTES.instructions,
    task: {
      type: "quote_note",
      customerName: input.customerName,
      lineCount: built.lines.length,
      totalClp,
      unmatched: "",
    },
    usage: USAGE_PRESETS.quote,
  });
  await prisma.quote.create({
    data: {
      organizationId: input.organizationId,
      number: input.number,
      customerName: input.customerName,
      notes: input.notes,
      agentNote: note.outputText,
      status: input.status,
      totalClp,
      lines: { create: built.lines },
    },
  });
  await prisma.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      agent: "QUOTES",
      metric: "QUOTES",
      quantity: 1,
      model: AGENT_CATALOG.QUOTES.model,
      ...USAGE_PRESETS.quote,
    },
  });
}

async function ensureBrand(
  organizationId: string,
  brand: { voice: string; audience: string; summary: string },
) {
  const existing = await prisma.brandProfile.findUnique({ where: { organizationId }, select: { id: true } });
  if (existing) return;
  await prisma.brandProfile.create({ data: { organizationId, ...brand } });
}

async function ensureMarketingPost(input: {
  organizationId: string;
  voice: string;
  audience: string;
  summary: string;
  index: number;
  client: MockXaiClient;
}) {
  const channel = channelFor(input.index);
  const title = `${channel} · idea ${input.index + 1}`;
  const existing = await prisma.marketingPost.findFirst({
    where: { organizationId: input.organizationId, title },
    select: { id: true },
  });
  if (existing) return;

  const text = await input.client.respond({
    model: AGENT_CATALOG.MARKETING.model,
    instructions: AGENT_CATALOG.MARKETING.instructions,
    task: {
      type: "marketing_post",
      channel,
      voice: input.voice,
      audience: input.audience,
      summary: input.summary,
      index: input.index,
    },
    usage: USAGE_PRESETS.text,
  });
  const image = await input.client.respond({
    model: "grok-imagine-image-2.0",
    instructions: AGENT_CATALOG.MARKETING.instructions,
    task: { type: "marketing_image", summary: input.summary, channel },
    usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
  });
  const draft = toMarketingRecord({
    channel,
    index: input.index,
    copy: text.outputText,
    imagePrompt: image.outputText,
    imageSvg: draftImageSvg(channel, image.outputText),
  });
  await prisma.marketingPost.create({ data: { organizationId: input.organizationId, ...draft } });
  await prisma.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      agent: "MARKETING",
      metric: "TEXTS",
      quantity: 1,
      model: AGENT_CATALOG.MARKETING.model,
      ...USAGE_PRESETS.text,
    },
  });
  await prisma.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      agent: "MARKETING",
      metric: "IMAGES",
      quantity: 1,
      model: AGENT_CATALOG.MARKETING.model,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
