import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ChatMarkdown } from "@/components/chat-markdown";
import { VaultAccessForm } from "@/components/vault-access-form";
import { completeTurn, pushTurn } from "@/lib/chat/followups";
import { historyWhere, latestWindow, MODEL_HISTORY_LIMIT } from "@/lib/chat/history";
import { prepareModelTurn } from "@/lib/chat/model-turn";
import { SAFE_CREDENTIAL_ENTRY, sealChatText } from "@/lib/chat/secrets";
import { wantsSecureCredentialForm } from "@/lib/chat/sensitive";
import { createCredential } from "@/lib/credentials/service";
import { portalPresetFromText, vaultFormMessage, vaultFormPath } from "@/lib/credentials/portal-form";
import { publicCredentialJson, type CredentialRepo, type StoredCredential } from "@/lib/credentials/types";
import { OKS } from "@/lib/notices";
import { renderMockTask } from "@/lib/xai/mock";
import { USAGE_PRESETS } from "@/lib/pricing";
import type { XaiRequest } from "@/lib/xai/types";

const SECRET = "Sintetica-7f3a";
const RUT = "12.345.678-5";
const VAULT_ASK = "Guarda el RUT y la clave en la bóveda para la revisión del SII";
const IVA = "¿Cuándo se paga el IVA de noviembre?";
const VAULT_NOTE = "Bóveda (solo id, nombre, portal y pista de usuario; nunca la clave):\n- id cred12345678: Clave SII (SII), usuario 78-5";

vi.mock("@/lib/chat/store", () => ({
  saveUserMessage: vi.fn(),
  saveCountedAssistantMessage: vi.fn(),
  saveConfirmation: vi.fn(),
  saveAssistantMessage: vi.fn(),
  loadHistory: vi.fn(),
  missingTable: () => false,
  toPublic: (message: { id: string; role: "USER" | "ASSISTANT"; kind?: string; body: string; createdAt?: Date }) => ({
    id: message.id,
    role: message.role,
    kind: message.kind ?? "TEXT",
    body: message.body,
    action: "",
    actionTitle: "",
    confirmation: null,
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : "2026-11-07T22:02:00.000Z",
    attachments: [],
  }),
}));

vi.mock("@/lib/xai/client", () => ({
  createXaiClient: vi.fn(),
  xaiUsesNetwork: () => false,
}));

vi.mock("@/lib/credentials/repo", () => ({
  prismaCredentialRepo: vi.fn(() => {
    throw new Error("no debía leer ni descifrar la bóveda");
  }),
}));

vi.mock("@/lib/usage-store", () => ({
  usedThisMonth: vi.fn(async () => 1),
  reserveUsage: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/meter-store", () => ({
  recordModelCall: vi.fn(),
  recordCompletedTask: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
  prisma: {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        agentMessage: {
          create: vi.fn(async ({ data }: { data: { body: string } }) => ({
            id: "asst-model",
            role: "ASSISTANT",
            kind: "TEXT",
            body: data.body,
            createdAt: new Date("2026-11-07T22:05:00.000Z"),
            attachments: [],
          })),
        },
      }),
    ),
    agentMessage: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

import { loadHistory, saveCountedAssistantMessage, saveUserMessage } from "@/lib/chat/store";
import { streamChatTurn } from "@/lib/chat/run";
import { createXaiClient } from "@/lib/xai/client";
import { prismaCredentialRepo } from "@/lib/credentials/repo";

function bubble(id: string, role: "USER" | "ASSISTANT", body: string) {
  return {
    id,
    role,
    kind: "TEXT" as const,
    body,
    action: "",
    actionTitle: "",
    confirmation: null,
    createdAt: "2026-11-07T21:52:00.000Z",
    attachments: [],
  };
}

function threadRows(count: number) {
  const start = Date.parse("2026-11-07T18:00:00.000Z");
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `m${String(index).padStart(3, "0")}`,
    createdAt: new Date(start + index * 1000),
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: index % 2 === 0 ? `Sigue con Torre San Isidro, punto ${index}` : `Respuesta sobre Torre San Isidro ${index}`,
    threadId: "thread-a",
    organizationId: "org-a",
  }));
  rows.push({
    id: "m-vault",
    createdAt: new Date(start + count * 1000),
    role: "user",
    text: VAULT_ASK,
    threadId: "thread-a",
    organizationId: "org-a",
  });
  rows.push({
    id: "m-iva",
    createdAt: new Date(start + (count + 1) * 1000),
    role: "user",
    text: IVA,
    threadId: "thread-a",
    organizationId: "org-a",
  });
  return rows;
}

function oldestPage<T extends { id: string; createdAt: Date }>(rows: readonly T[], limit: number) {
  return [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}

describe("pedido vigente frente a Torre San Isidro", () => {
  test("el recorte viejo asc+take esconde el pedido nuevo; la ventana nueva lo deja al final", () => {
    const rows = threadRows(30);
    const stale = oldestPage(rows, MODEL_HISTORY_LIMIT);
    expect(stale.at(-1)?.text).toMatch(/Torre San Isidro/);
    expect(stale.some((row) => row.text === VAULT_ASK || row.text === IVA)).toBe(false);

    const recent = latestWindow(rows, MODEL_HISTORY_LIMIT);
    expect(recent).toHaveLength(MODEL_HISTORY_LIMIT);
    expect(recent.at(-1)?.text).toBe(IVA);
    expect(recent.some((row) => row.text === VAULT_ASK)).toBe(true);
    expect(recent[0]?.text).not.toBe(rows[0]?.text);
  });

  test("el hilo de otra empresa no entra en la consulta", () => {
    const where = historyWhere("thread-a", "org-a");
    const rows = [
      { threadId: "thread-a", organizationId: "org-a", text: IVA },
      { threadId: "thread-a", organizationId: "org-b", text: "Torre San Isidro de otra empresa" },
      { threadId: "thread-b", organizationId: "org-a", text: "otro hilo" },
    ];
    const visible = rows.filter(
      (row) => row.threadId === where.threadId && row.organizationId === where.thread.organizationId,
    );
    expect(where.thread.agent).toBe("ACCOUNTING");
    expect(visible.map((row) => row.text)).toEqual([IVA]);
  });

  test("detener la respuesta sigue con el pedido nuevo, no reenvía Torre San Isidro", () => {
    const first = pushTurn({ active: null, waiting: [] }, { id: "torre", text: "Sigue con Torre San Isidro" });
    const queued = pushTurn(first.queue, { id: "vault", text: VAULT_ASK });
    expect(queued.startNow).toBe(false);
    const stopped = completeTurn(queued.queue, "abort");
    expect(stopped.next).toEqual({ id: "vault", text: VAULT_ASK });
    expect(stopped.queue.active?.id).toBe("vault");
  });
});

describe("formulario directo de la bóveda", () => {
  test("entrar al SII o guardar RUT y clave abre el formulario, sin simular el ingreso", () => {
    expect(wantsSecureCredentialForm(VAULT_ASK)).toBe(true);
    expect(wantsSecureCredentialForm("Entra al SII a revisar ventas")).toBe(true);
    expect(wantsSecureCredentialForm(IVA)).toBe(false);
    expect(wantsSecureCredentialForm("Presenta el F29 de octubre")).toBe(false);
    expect(portalPresetFromText(VAULT_ASK)).toBe("sii");
    const message = vaultFormMessage("sii");
    expect(message).toContain(vaultFormPath("sii"));
    expect(message).toContain("Usuario / RUT");
    expect(message).toContain("campo Clave");
    expect(message).toContain("consentimiento");
    expect(message).toMatch(/No entré al portal/);
    expect(message).not.toMatch(/Usando la bóveda|yo la uso|Dejé en cola|Entr[eé] al SII/);
    expect(message).not.toContain(SECRET);
    const html = renderToStaticMarkup(createElement(ChatMarkdown, { text: message }));
    expect(html).toContain('href="/panel/boveda?portal=sii#agregar-acceso"');
    expect(html).not.toContain("javascript:");
    expect(OKS.boveda_guardada).toMatch(/No entré a ningún portal/);
  });

  test("el formulario preset del SII enmascara la clave y explica el RUT", () => {
    const html = renderToStaticMarkup(
      createElement(VaultAccessForm, {
        preset: {
          id: "sii",
          portal: "SII",
          label: "Clave SII",
          usernameLabel: "Usuario / RUT",
          usernamePlaceholder: "12.345.678-9",
        },
      }),
    );
    expect(html).toContain('id="agregar-acceso"');
    expect(html).toContain("Usuario / RUT");
    expect(html).toContain('name="portal"');
    expect(html).toContain('value="SII"');
    expect(html).toContain('name="portalPreset"');
    expect(html).toContain('value="sii"');
    expect(html).toContain('type="password"');
    expect(html).toContain('name="consent"');
    expect(html).toContain("Guardar no entra al portal");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("?");
  });

  test("un alta sintética no devuelve ni registra el secreto en claro", async () => {
    const credentials: StoredCredential[] = [];
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logs.push(String(line));
    });
    const repo = {
      async list(organizationId: string) {
        return credentials.filter((row) => row.organizationId === organizationId);
      },
      async insert(data: Omit<StoredCredential, "id" | "createdAt" | "updatedAt" | "lastUsedAt">) {
        const row: StoredCredential = {
          ...data,
          id: "cred12345678",
          createdAt: new Date("2026-11-07T22:02:00.000Z"),
          updatedAt: new Date("2026-11-07T22:02:00.000Z"),
          lastUsedAt: null,
        };
        credentials.push(row);
        return row;
      },
    } as unknown as CredentialRepo;
    const result = await createCredential(
      repo,
      {
        organizationId: "org-a",
        actorUserId: "user-a",
        label: "Clave SII",
        portal: "SII",
        username: RUT,
        secret: SECRET,
        consentAcceptedAt: true,
      },
      { CREDENTIALS_MASTER_KEY: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64") },
    );
    spy.mockRestore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pub = JSON.stringify(publicCredentialJson(result.credential));
    expect(pub).not.toContain(SECRET);
    expect(pub).not.toContain(RUT);
    expect(result.credential.usernameHint).toBe("78-5");
    expect(logs.join("\n")).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(RUT);
    expect(credentials[0]?.ciphertext).not.toContain(SECRET);
  });
});

describe("un IVA posterior no hereda la bóveda", () => {
  test("la nota de la bóveda no se vuelve el último mensaje del cliente", () => {
    const history = [
      { role: "user" as const, text: "Sigue con Torre San Isidro" },
      { role: "assistant" as const, text: "Sobre Torre San Isidro, el terreno tributa así." },
      { role: "user" as const, text: `clave es ${SECRET}. ${VAULT_ASK} ${RUT}` },
      { role: "assistant" as const, text: vaultFormMessage("sii") },
      { role: "user" as const, text: IVA },
    ];
    const prepared = prepareModelTurn(history, VAULT_NOTE);
    expect(prepared.vaultNote).toBe("");
    expect(prepared.messages.at(-1)).toEqual({ role: "user", text: IVA });
    expect(prepared.messages.some((message) => message.text.includes(VAULT_NOTE.slice(0, 24)))).toBe(false);
    expect(JSON.stringify(prepared.messages)).not.toContain(SECRET);
    expect(JSON.stringify(prepared.messages)).not.toContain(RUT);
    expect(JSON.stringify(prepared.messages)).not.toContain("Demo");
    expect(prepared.messages.some((message) => message.text === SAFE_CREDENTIAL_ENTRY)).toBe(true);
    const answer = renderMockTask({
      type: "agent_chat",
      today: "7 de noviembre de 2026",
      messages: prepared.messages,
    });
    expect(answer).toContain(IVA);
    expect(answer).not.toContain("Respuesta de prueba para: Sigue con Torre San Isidro");
    expect(answer).not.toContain("Bóveda (solo id");
    expect(sealChatText(`mi clave es ${SECRET}`)).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(sealChatText("El RUT 76.123.456-7 va en la factura del cliente.")).toBe(
      "El RUT 76.123.456-7 va en la factura del cliente.",
    );
    expect(sealChatText("¿Cuál es la clave del F29?")).toBe("¿Cuál es la clave del F29?");
  });
});

describe("corpus de claves sintéticas", () => {
  const samples = [
    { name: "punto", text: "clave: Demo.1234", fragments: ["Demo.1234", "Demo", ".1234", "1234"] },
    { name: "punto y coma", text: "clave: Demo;1234", fragments: ["Demo;1234", ";1234", "Demo", "1234"] },
    { name: "coma", text: "clave: Demo,1234", fragments: ["Demo,1234", "Demo", "1234"] },
    { name: "símbolos", text: "clave: p@ss/w0rd!", fragments: ["p@ss/w0rd!", "p@ss", "w0rd"] },
    { name: "espacio sin dos puntos", text: "clave Demo1234", fragments: ["Demo1234", "Demo", "1234"] },
    { name: "password en inglés", text: "my password is Demo.1234", fragments: ["Demo.1234", "Demo", "1234"] },
    { name: "contraseña", text: "contraseña: Demo;1234", fragments: ["Demo;1234", ";1234", "1234"] },
    { name: "igual", text: "passwd=Demo.1234", fragments: ["Demo.1234", "Demo", "1234"] },
    { name: "varias líneas", text: "usuario: 12.345.678-5\nclave:\nDemo.1234", fragments: ["12.345.678-5", "Demo.1234", "Demo", "1234"] },
    { name: "mezcla", text: "Guarda el RUT 12.345.678-5 y la clave Demo.1234 en la bóveda", fragments: ["12.345.678-5", "Demo.1234", "Demo", "1234"] },
  ];

  test.each(samples)("$name no conserva fragmentos", ({ text, fragments }) => {
    const sealed = sealChatText(text);
    expect(sealed).toBe(SAFE_CREDENTIAL_ENTRY);
    for (const fragment of fragments) expect(sealed).not.toContain(fragment);
    const prepared = prepareModelTurn(
      [
        { role: "user", text },
        { role: "user", text: "¿Cuándo se paga el IVA de noviembre?" },
      ],
      "Bóveda (solo id, nombre, portal y pista de usuario; nunca la clave):",
    );
    const packed = JSON.stringify(prepared);
    for (const fragment of fragments) expect(packed).not.toContain(fragment);
    expect(prepared.messages[1]?.text).toBe("¿Cuándo se paga el IVA de noviembre?");
    expect(prepared.vaultNote).toBe("");
  });
});

describe("turno de chat", () => {
  beforeEach(() => {
    vi.mocked(saveUserMessage).mockReset();
    vi.mocked(saveCountedAssistantMessage).mockReset();
    vi.mocked(loadHistory).mockReset();
    vi.mocked(createXaiClient).mockReset();
    vi.mocked(prismaCredentialRepo).mockClear();
    vi.mocked(saveUserMessage).mockImplementation(async ({ body }: { body: string }) => ({
      threadId: "thread-a",
      message: bubble("user-1", "USER", body),
    }));
    vi.mocked(saveCountedAssistantMessage).mockImplementation(async (_org: string, _thread: string, body: string) =>
      bubble("asst-1", "ASSISTANT", body),
    );
  });

  test("el pedido de RUT y clave no llama al modelo ni a la bóveda y no guarda el secreto", async () => {
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: `${VAULT_ASK}. clave es ${SECRET}. RUT ${RUT}`,
      files: [],
    })) {
      events.push(event);
    }
    const user = events.find((event) => event.type === "user");
    const assistant = events.find((event) => event.type === "message");
    expect(user && user.type === "user" ? user.message.body : "").toBe(SAFE_CREDENTIAL_ENTRY);
    expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({ body: SAFE_CREDENTIAL_ENTRY, files: [] });
    expect(user && user.type === "user" && user.message.body).not.toContain(SECRET);
    expect(user && user.type === "user" && user.message.body).not.toContain(RUT);
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toContain(
      "/panel/boveda?portal=sii#agregar-acceso",
    );
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toContain("Usuario / RUT");
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(events)).not.toContain("Usando la bóveda");
    expect(JSON.stringify(events)).not.toMatch(/Entr[eé] al SII|yo la uso|Dejé en cola/);
    expect(loadHistory).not.toHaveBeenCalled();
    expect(createXaiClient).not.toHaveBeenCalled();
    expect(prismaCredentialRepo).not.toHaveBeenCalled();
  });

  test("clave: Demo.1234 no se guarda, no va al modelo y no entra al log", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: "clave: Demo.1234",
      files: [{ fileName: "nota.txt", mimeType: "text/plain", bytes: new Uint8Array([1]) }],
    })) {
      events.push(event);
    }
    const logged = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    spy.mockRestore();
    const packed = `${JSON.stringify(events)}\n${logged}`;
    expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({ body: SAFE_CREDENTIAL_ENTRY, files: [] });
    for (const fragment of ["Demo.1234", "Demo", ".1234", "1234", "nota.txt"]) expect(packed).not.toContain(fragment);
    expect(createXaiClient).not.toHaveBeenCalled();
    const assistant = events.find((event) => event.type === "message");
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toContain("/panel/boveda#agregar-acceso");
  });

  test("un texto ya sellado con portal permitido abre el formulario del SII", async () => {
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: SAFE_CREDENTIAL_ENTRY,
      portal: "sii",
      files: [],
    })) {
      events.push(event);
    }
    const assistant = events.find((event) => event.type === "message");
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toContain(
      "/panel/boveda?portal=sii#agregar-acceso",
    );
    expect(createXaiClient).not.toHaveBeenCalled();
  });

  test("el IVA siguiente se responde solo y no arrastra la nota de la bóveda", async () => {
    const seen: { last: string; instructions: string } = { last: "", instructions: "" };
    vi.mocked(loadHistory).mockResolvedValue([
      { role: "user", text: "Sigue con Torre San Isidro" },
      { role: "assistant", text: "Sobre Torre San Isidro." },
      { role: "user", text: VAULT_ASK },
      { role: "assistant", text: vaultFormMessage("sii") },
      { role: "user", text: IVA },
    ]);
    vi.mocked(createXaiClient).mockReturnValue({
      async respond() {
        throw new Error("no debía usar respond");
      },
      async *streamRespond(request: XaiRequest) {
        seen.instructions = request.instructions;
        seen.last = request.task.type === "agent_chat" ? (request.task.messages.at(-1)?.text ?? "") : "";
        const outputText = renderMockTask(request.task);
        yield {
          type: "done" as const,
          response: {
            id: "mock_iva",
            model: request.model,
            outputText,
            usage: USAGE_PRESETS.text,
            mocked: true,
          },
        };
      },
    });
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: IVA,
      files: [],
    })) {
      events.push(event);
    }
    const statuses = events.filter((event) => event.type === "status").map((event) => event.text);
    expect(statuses).not.toContain("Usando la bóveda…");
    expect(seen.last).toBe(IVA);
    expect(seen.instructions).not.toContain("Bóveda (solo id");
    const assistant = events.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toContain(IVA);
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").not.toContain("Torre San Isidro, punto");
    expect(prismaCredentialRepo).not.toHaveBeenCalled();
  });
});

describe("navegación del contador en móvil", () => {
  test("el menú del chat queda en un carril con ancho máximo, no en una fila que empuja la página", () => {
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    const start = css.indexOf(".panel-shell:has(.contador-screen) .panel-nav {");
    expect(start).toBeGreaterThan(0);
    const block = css.slice(start, start + 500);
    expect(block).toContain("max-width: 100%");
    expect(block).toContain("overflow-x: auto");
    expect(block).toContain("min-width: 0");
  });
});
