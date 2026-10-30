import { PrismaClient } from "@prisma/client";
import { channelFor, draftImageSvg, toMarketingRecord } from "../src/lib/agents/marketing";
import { buildQuoteLines, matchFreeText, quoteTotal } from "../src/lib/agents/quotes";
import { decideWhatsappReply } from "../src/lib/agents/whatsapp";
import { AGENT_CATALOG } from "../src/lib/catalog";
import { hashPassword } from "../src/lib/password";
import { USAGE_PRESETS } from "../src/lib/pricing";
import { trialEnd } from "../src/lib/subscription";
import { MockXaiClient } from "../src/lib/xai/mock";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "Clave-demo-2026";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO !== "1") {
    throw new Error("El seed de demostración no corre en producción. Define SEED_DEMO=1 si de verdad quieres cargarlo.");
  }

  const existing = await prisma.user.findUnique({ where: { email: "maria@losaromos.cl" } });
  if (existing) {
    console.log("El seed ya estaba cargado. No se duplicaron las empresas de demostración.");
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const client = new MockXaiClient();
  await seedFerreteria(passwordHash, client);
  await seedCafe(passwordHash, client);
  console.log("Empresas de demostración listas.");
  console.log("maria@losaromos.cl / Clave-demo-2026  ·  Ferretería Los Aromos");
  console.log("pedro@cafedelpuerto.cl / Clave-demo-2026  ·  Café del Puerto");
}

async function seedFerreteria(passwordHash: string, client: MockXaiClient) {
  const organizationId = await createOwner({
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
  await prisma.knowledgeItem.createMany({
    data: knowledge.map((item) => ({ ...item, organizationId })),
  });
  await answerSample({
    organizationId,
    customerLabel: "Cliente del mesón",
    question: "¿A qué hora abren el sábado?",
    knowledge,
    client,
  });

  const pintura = await prisma.priceItem.create({
    data: {
      organizationId,
      sku: "PIN-1G",
      name: "Pintura látex blanco 1 galón",
      unit: "galón",
      priceClp: 18990,
    },
  });
  const taladro = await prisma.priceItem.create({
    data: {
      organizationId,
      sku: "TAL-650",
      name: "Taladro percutor 650 W",
      unit: "unidad",
      priceClp: 59990,
    },
  });
  await prisma.priceItem.create({
    data: {
      organizationId,
      sku: "TOR-14",
      name: "Tornillo hexagonal 1/4 x 1",
      unit: "unidad",
      priceClp: 120,
    },
  });
  await prisma.priceItem.create({
    data: {
      organizationId,
      sku: "CAN-40",
      name: "Candado 40 mm",
      unit: "unidad",
      priceClp: 4590,
    },
  });
  const catalog = [pintura, taladro];
  const built = buildQuoteLines(
    matchFreeText("2 galones de pintura látex blanco y 1 taladro percutor", catalog),
    catalog,
  );
  const totalClp = quoteTotal(built.lines);
  const note = await client.respond({
    model: AGENT_CATALOG.QUOTES.model,
    instructions: AGENT_CATALOG.QUOTES.instructions,
    task: {
      type: "quote_note",
      customerName: "Maestranza Los Robles",
      lineCount: built.lines.length,
      totalClp,
      unmatched: "",
    },
    usage: USAGE_PRESETS.quote,
  });
  await prisma.quote.create({
    data: {
      organizationId,
      number: 1,
      customerName: "Maestranza Los Robles",
      notes: "Obra en Ñuñoa. Retiran el viernes.",
      agentNote: note.outputText,
      status: "PENDING_APPROVAL",
      totalClp,
      lines: { create: built.lines },
    },
  });
  await prisma.usageEvent.create({
    data: {
      organizationId,
      agent: "QUOTES",
      metric: "QUOTES",
      quantity: 1,
      ...USAGE_PRESETS.quote,
    },
  });

  await prisma.brandProfile.create({
    data: {
      organizationId,
      voice: "cercana y clara, sin tecnicismos",
      audience: "dueños de casa y maestros en Santiago",
      summary: "Ferretería de barrio con despacho dentro de Santiago.",
    },
  });
  const text = await client.respond({
    model: AGENT_CATALOG.MARKETING.model,
    instructions: AGENT_CATALOG.MARKETING.instructions,
    task: {
      type: "marketing_post",
      channel: channelFor(0),
      voice: "cercana y clara, sin tecnicismos",
      audience: "dueños de casa y maestros en Santiago",
      summary: "Ferretería de barrio con despacho dentro de Santiago.",
      index: 0,
    },
    usage: USAGE_PRESETS.text,
  });
  const image = await client.respond({
    model: "grok-imagine-image-2.0",
    instructions: AGENT_CATALOG.MARKETING.instructions,
    task: {
      type: "marketing_image",
      summary: "Ferretería de barrio con despacho dentro de Santiago.",
      channel: channelFor(0),
    },
    usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
  });
  const draft = toMarketingRecord({
    channel: channelFor(0),
    index: 0,
    copy: text.outputText,
    imagePrompt: image.outputText,
    imageSvg: draftImageSvg(channelFor(0), image.outputText),
  });
  await prisma.marketingPost.create({ data: { organizationId, ...draft } });
  await prisma.usageEvent.create({
    data: {
      organizationId,
      agent: "MARKETING",
      metric: "TEXTS",
      quantity: 1,
      ...USAGE_PRESETS.text,
    },
  });
  await prisma.usageEvent.create({
    data: { organizationId, agent: "MARKETING", metric: "IMAGES", quantity: 1 },
  });
}

async function seedCafe(passwordHash: string, client: MockXaiClient) {
  const organizationId = await createOwner({
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
  await prisma.knowledgeItem.createMany({
    data: knowledge.map((item) => ({ ...item, organizationId })),
  });
  await answerSample({
    organizationId,
    customerLabel: "Vecina del cerro",
    question: "¿A qué hora abren el domingo?",
    knowledge,
    client,
  });
  await prisma.priceItem.createMany({
    data: [
      { organizationId, sku: "ESP-01", name: "Espresso doble", unit: "taza", priceClp: 2500 },
      { organizationId, sku: "CAF-01", name: "Café de grano 250 g", unit: "bolsa", priceClp: 8990 },
      { organizationId, sku: "QUE-01", name: "Queque de naranja", unit: "porción", priceClp: 3200 },
    ],
  });
  await prisma.brandProfile.create({
    data: {
      organizationId,
      voice: "cálida y breve",
      audience: "vecinos de Valparaíso que pasan por el puerto",
      summary: "Café de especialidad con queque de naranja y grano tostado en casa.",
    },
  });
}

async function createOwner(input: {
  email: string;
  person: string;
  organization: string;
  slug: string;
  rut: string;
  passwordHash: string;
}) {
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.person,
      passwordHash: input.passwordHash,
      memberships: {
        create: {
          role: "OWNER",
          organization: {
            create: {
              name: input.organization,
              slug: input.slug,
              rut: input.rut,
              subscriptions: {
                create: (["WHATSAPP", "QUOTES", "MARKETING"] as const).map((agent) => ({
                  agent,
                  status: "TRIAL" as const,
                  periodStart: now,
                  periodEnd: trialEnd(now),
                })),
              },
            },
          },
        },
      },
    },
    include: { memberships: true },
  });
  return user.memberships[0].organizationId;
}

async function answerSample(input: {
  organizationId: string;
  customerLabel: string;
  question: string;
  knowledge: { title: string; body: string }[];
  client: MockXaiClient;
}) {
  const decision = decideWhatsappReply(input.question, input.knowledge.map((item, index) => ({ id: String(index), ...item })));
  if (decision.kind !== "answer") {
    throw new Error(`El seed esperaba una respuesta de ficha para: ${input.question}`);
  }
  const response = await input.client.respond({
    model: AGENT_CATALOG.WHATSAPP.model,
    instructions: AGENT_CATALOG.WHATSAPP.instructions,
    task: { type: "whatsapp_answer", title: decision.item.title, body: decision.item.body },
    usage: USAGE_PRESETS.whatsapp,
  });
  const started = new Date();
  await prisma.conversation.create({
    data: {
      organizationId: input.organizationId,
      customerLabel: input.customerLabel,
      messages: {
        create: [
          { role: "CUSTOMER", body: input.question, createdAt: started },
          {
            role: "AGENT",
            body: response.outputText,
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
      ...USAGE_PRESETS.whatsapp,
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
