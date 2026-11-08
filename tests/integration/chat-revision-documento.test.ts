import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { streamChatTurn } from "@/lib/chat/run";
import { SAFE_CREDENTIAL_ENTRY } from "@/lib/chat/secrets";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { USAGE_PRESETS } from "@/lib/pricing";
import * as xai from "@/lib/xai/client";
import type { XaiRequest, XaiStreamEvent } from "@/lib/xai/types";

/**
 * El modelo es el cliente simulado que captura el pedido.
 * La respuesta es un texto fijo: no lee el PDF.
 */
const REVIEW = "Respuesta de revisión de prueba.";
const PDF = {
  fileName: "f29.pdf",
  mimeType: "application/pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]),
};

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function makeOrg() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `revision-${suffix}@test.local`,
      name: "Ana",
      passwordHash: await hashPassword("Clave-demo-2026"),
      memberships: {
        create: { role: "OWNER", organization: { create: { name: "Revision", slug: `revision-${suffix}` } } },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  const organizationId = user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("sin empresa");
  createdOrgs.push(organizationId);
  return organizationId;
}

function captureReview() {
  const seen: XaiRequest[] = [];
  const model = vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
    async respond() {
      throw new Error("no");
    },
    async *streamRespond(request: XaiRequest): AsyncGenerator<XaiStreamEvent> {
      seen.push(request);
      yield {
        type: "done",
        response: {
          id: "rev",
          model: request.model,
          outputText: REVIEW,
          usage: USAGE_PRESETS.text,
          mocked: true,
        },
      };
    },
  }));
  return { seen, model };
}

async function lastTurn(organizationId: string) {
  const user = await prisma.agentMessage.findFirst({
    where: { role: "USER", thread: { organizationId } },
    orderBy: { createdAt: "desc" },
    include: { attachments: true },
  });
  const assistant = await prisma.agentMessage.findFirst({
    where: { role: "ASSISTANT", thread: { organizationId } },
    orderBy: { createdAt: "desc" },
  });
  return { user, assistant };
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("revisión documental con PostgreSQL y modelo simulado", () => {
  test("el formulario 29 adjunto conserva el pedido y no abre la Bóveda", async () => {
    const organizationId = await makeOrg();
    const text = "Revisa el formulario 29 del SII que te adjunto";
    const { seen, model } = captureReview();
    const events = [];
    for await (const event of streamChatTurn({
      organizationId,
      organizationName: "Revision",
      actorUserId: "user",
      text,
      files: [PDF],
    })) {
      events.push(event);
    }
    const stored = await lastTurn(organizationId);
    const request = seen[0];
    const task = request?.task.type === "agent_chat" ? request.task : null;
    const last = task?.messages.at(-1);
    expect(stored.user?.body).toBe(text);
    expect(stored.user?.attachments).toHaveLength(1);
    expect(stored.user?.attachments[0]?.fileName).toBe(PDF.fileName);
    expect(stored.user?.attachments[0]?.mimeType).toBe(PDF.mimeType);
    expect(last?.text).toBe(text);
    expect(last?.files?.[0]?.name).toBe(PDF.fileName);
    expect(last?.files?.[0]?.note).toBe(`Archivo adjunto: ${PDF.fileName} (${PDF.mimeType}).`);
    expect(request?.instructions).not.toContain("Bóveda (solo id");
    expect(stored.assistant?.body).toBe(REVIEW);
    expect(JSON.stringify(events)).toContain(REVIEW);
    expect(JSON.stringify(events)).not.toContain("/panel/boveda");
    expect(model).toHaveBeenCalled();
  });

  test("la clave del éxito y su PDF llegan al modelo", async () => {
    const organizationId = await makeOrg();
    const text = "Mi clave del éxito es constancia. Revisa el formulario que adjunto";
    const { seen } = captureReview();
    const events = [];
    for await (const event of streamChatTurn({
      organizationId,
      organizationName: "Revision",
      actorUserId: "user",
      text,
      files: [PDF],
    })) {
      events.push(event);
    }
    const stored = await lastTurn(organizationId);
    const request = seen[0];
    const task = request?.task.type === "agent_chat" ? request.task : null;
    const last = task?.messages.at(-1);
    expect(stored.user?.body).toBe(text);
    expect(stored.user?.attachments).toHaveLength(1);
    expect(last?.text).toBe(text);
    expect(last?.files?.[0]?.name).toBe(PDF.fileName);
    expect(stored.assistant?.body).toBe(REVIEW);
    expect(JSON.stringify(events)).toContain(REVIEW);
    expect(JSON.stringify(events)).not.toContain("/panel/boveda");
  });

  test("la factura y la pregunta por el crédito fiscal llegan juntas al modelo", async () => {
    const organizationId = await makeOrg();
    const text = "Te pego la factura; ¿cuál es la clave del crédito fiscal?";
    const file = { ...PDF, fileName: "factura.pdf" };
    const { seen } = captureReview();
    const events = [];
    for await (const event of streamChatTurn({
      organizationId,
      organizationName: "Revision",
      actorUserId: "user",
      text,
      files: [file],
    })) {
      events.push(event);
    }
    const stored = await lastTurn(organizationId);
    const request = seen[0];
    const task = request?.task.type === "agent_chat" ? request.task : null;
    const last = task?.messages.at(-1);
    const packed = `${JSON.stringify(events)}\n${stored.user?.body ?? ""}\n${stored.assistant?.body ?? ""}`;
    expect(stored.user?.body).toBe(text);
    expect(stored.user?.attachments).toHaveLength(1);
    expect(stored.user?.attachments[0]?.fileName).toBe("factura.pdf");
    expect(last?.text).toBe(text);
    expect(last?.files?.[0]?.note).toContain("factura.pdf");
    expect(stored.assistant?.body).toBe(REVIEW);
    expect(packed).toContain("crédito fiscal");
    expect(packed).not.toContain("/panel/boveda");
    expect(request?.instructions).not.toContain("Bóveda (solo id");
  });

  test("entrar, guardar un acceso o entregar una clave abre el formulario y no llama al modelo", async () => {
    const model = vi.spyOn(xai, "createXaiClient");
    const cases = [
      { text: "Quiero entrar al SII", secret: "", files: [] as (typeof PDF)[] },
      { text: "Guarda mi acceso del SII", secret: "", files: [] as (typeof PDF)[] },
      { text: "Mi clave del SII es hola", secret: "hola", files: [PDF] },
      {
        text: "Revisa el formulario 29 del SII que te adjunto. Mi clave del SII es hola",
        secret: "hola",
        files: [PDF],
      },
    ];
    for (const item of cases) {
      const organizationId = await makeOrg();
      model.mockClear();
      const events = [];
      for await (const event of streamChatTurn({
        organizationId,
        organizationName: "Revision",
        actorUserId: "user",
        text: item.text,
        files: item.files,
      })) {
        events.push(event);
      }
      const stored = await lastTurn(organizationId);
      const packed = `${JSON.stringify(events)}\n${stored.user?.body ?? ""}\n${stored.assistant?.body ?? ""}`;
      expect(stored.user?.body).toBe(SAFE_CREDENTIAL_ENTRY);
      expect(stored.user?.attachments).toHaveLength(0);
      expect(stored.assistant?.body).toContain("/panel/boveda?portal=sii#agregar-acceso");
      expect(stored.assistant?.body).toMatch(/No las escribas en este chat/);
      expect(stored.assistant?.body).toMatch(/No entré al portal/);
      expect(stored.assistant?.body).not.toMatch(/Entr[eé] al SII|pásame|escríbeme|revis[eé] el|le[ií] el pdf/i);
      if (item.secret) expect(packed).not.toContain(item.secret);
      expect(model).not.toHaveBeenCalled();
    }
  });

  test("una contraseña con valor funcional no se guarda, no va al modelo y suelta el adjunto", async () => {
    const model = vi.spyOn(xai, "createXaiClient");
    const cases = [
      { text: "Mi contraseña del SII es tu", absent: ["tu", "Mi contraseña del SII es tu"] },
      { text: "Mi contraseña de la empresa es «la»", absent: ["«la»", "Mi contraseña de la empresa es «la»"] },
      { text: "Mi contraseña del SII es\nmi", absent: ["Mi contraseña del SII es\nmi"] },
      { text: "Mi clave del SII es la de siempre", absent: ["siempre", "Mi clave del SII es la de siempre"] },
      { text: "Mi clave del SII es esto mismo", absent: ["mismo", "Mi clave del SII es esto mismo"] },
      { text: "Mi clave del SII es cuando llegue", absent: ["llegue", "Mi clave del SII es cuando llegue"] },
      {
        text: `Mi contraseña de la cuenta del SII ${Array.from({ length: 20 }, () => "zona").join(" ")} es la de siempre`,
        absent: ["siempre", "zona zona"],
      },
    ];
    for (const item of cases) {
      const organizationId = await makeOrg();
      model.mockClear();
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const events = [];
      let logged = "";
      try {
        for await (const event of streamChatTurn({
          organizationId,
          organizationName: "Revision",
          actorUserId: "user",
          text: item.text,
          files: [PDF],
        })) {
          events.push(event);
        }
        logged = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      } finally {
        spy.mockRestore();
      }
      const stored = await lastTurn(organizationId);
      const packed = `${JSON.stringify(events)}\n${logged}\n${stored.user?.body ?? ""}\n${stored.assistant?.body ?? ""}`;
      expect(stored.user?.body).toBe(SAFE_CREDENTIAL_ENTRY);
      expect(stored.user?.attachments).toHaveLength(0);
      expect(stored.assistant?.body).toContain(
        /\bsii\b/i.test(item.text) ? "/panel/boveda?portal=sii#agregar-acceso" : "/panel/boveda#agregar-acceso",
      );
      expect(stored.assistant?.body).toMatch(/No las escribas en este chat/);
      expect(stored.assistant?.body).toMatch(/No entré al portal/);
      expect(packed).not.toContain(item.text);
      expect(packed).not.toContain(JSON.stringify(item.text).slice(1, -1));
      for (const marker of item.absent) expect(packed).not.toContain(marker);
      if (item.text.endsWith("\nmi")) expect(packed).not.toMatch(/\bmi\b/i);
      expect(model).not.toHaveBeenCalled();
    }
  });
});
