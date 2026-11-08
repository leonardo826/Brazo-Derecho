import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, test } from "vitest";
import { streamChatTurn } from "@/lib/chat/run";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

async function makeOrg() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `tiempo-${suffix}@test.local`,
      name: "Ana",
      passwordHash: await hashPassword("Clave-demo-2026"),
      memberships: {
        create: {
          role: "OWNER",
          organization: { create: { name: "Tiempo", slug: `tiempo-${suffix}` } },
        },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  const organizationId = user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("sin empresa");
  createdOrgs.push(organizationId);
  const now = new Date();
  await prisma.subscription.create({
    data: {
      organizationId,
      agent: "ACCOUNTING",
      status: "TRIAL",
      periodStart: now,
      periodEnd: new Date(now.getTime() + 7 * 86_400_000),
    },
  });
  return organizationId;
}

async function turn(organizationId: string, text: string) {
  const started = performance.now();
  let ack = 0;
  let content = 0;
  let done = 0;
  let last = 0;
  let maxGap = 0;
  let chunks = 0;
  let output = "";
  const statuses: string[] = [];
  for await (const event of streamChatTurn({
    organizationId,
    organizationName: "Tiempo",
    actorUserId: "user",
    text,
    files: [],
  })) {
    const now = performance.now();
    if (event.type === "user" && ack === 0) ack = now - started;
    if (event.type === "status") statuses.push(event.text);
    if ((event.type === "delta" || (event.type === "message" && event.message.role === "ASSISTANT")) && content === 0) {
      content = now - started;
    }
    if (event.type === "delta") {
      if (last > 0) maxGap = Math.max(maxGap, now - last);
      last = now;
      chunks += 1;
      output += event.text;
    }
    if (event.type === "message" && event.message.role === "ASSISTANT") {
      output = event.message.body;
      if (last > 0) maxGap = Math.max(maxGap, now - last);
      last = now;
    }
    if (event.type === "done") done = now - started;
  }
  return {
    ack: Math.round(ack),
    content: Math.round(content),
    done: Math.round(done),
    maxGap: Math.round(maxGap),
    chunks,
    chars: output.length,
    form: output.includes("/panel/boveda?portal=sii#agregar-acceso"),
    statuses,
  };
}

describe("tiempos del contador con simulador", () => {
  test("muestra warm de respuesta corta y de formulario", async () => {
    const organizationId = await makeOrg();
    const cold = await turn(organizationId, "Resume qué es el IVA en dos frases, sin consultar portales");
    const warm: Awaited<ReturnType<typeof turn>>[] = [];
    for (let index = 0; index < 8; index += 1) {
      warm.push(await turn(organizationId, "Resume qué es el IVA en dos frases, sin consultar portales"));
    }
    const form = await turn(organizationId, "Quiero guardar un acceso del SII en el formulario seguro");
    expect(form.statuses.join(" ")).not.toMatch(/Revisando/);
    const content = warm.map((item) => item.content);
    const summary = {
      modo: "mock",
      cold_content_ms: cold.content,
      warm_n: warm.length,
      warm_ack_p50: percentile(warm.map((item) => item.ack), 50),
      warm_content_p50: percentile(content, 50),
      warm_content_p90: percentile(content, 90),
      warm_done_p50: percentile(warm.map((item) => item.done), 50),
      warm_max_gap_p50: percentile(warm.map((item) => item.maxGap), 50),
      form_content_ms: form.content,
      form_statuses: form.statuses,
    };
    writeFileSync("/tmp/chat-timing-candidate.json", JSON.stringify(summary));
    expect(form.form).toBe(true);
    expect(form.statuses).not.toContain("Revisando…");
    expect(summary.warm_content_p50).toBeGreaterThan(0);
    expect(summary.warm_content_p50).toBeLessThan(1_500);
  });
});

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});
