import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ChatMarkdown } from "@/components/chat-markdown";
import { VaultAccessForm } from "@/components/vault-access-form";
import { completeTurn, pushTurn } from "@/lib/chat/followups";
import { historyWhere, latestWindow, MODEL_HISTORY_LIMIT } from "@/lib/chat/history";
import { prepareModelTurn } from "@/lib/chat/model-turn";
import { prepareComposerTurn, SAFE_CREDENTIAL_ENTRY, sealChatText } from "@/lib/chat/secrets";
import { wantsSecureCredentialForm } from "@/lib/chat/sensitive";
import { createCredential } from "@/lib/credentials/service";
import { portalPresetFromText, vaultFormMessage, vaultFormPath } from "@/lib/credentials/portal-form";
import { publicCredentialJson, type CredentialRepo, type StoredCredential } from "@/lib/credentials/types";
import { OKS } from "@/lib/notices";
import { renderMockTask } from "@/lib/xai/mock";
import { USAGE_PRESETS } from "@/lib/pricing";
import type { XaiRequest } from "@/lib/xai/types";

const SECRET = "Sintetica-7f3a";
const EXAMPLE = "EjemploClavePrueba123";
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
  reserveDailyTask: vi.fn(async () => ({ ok: true, reservationId: null })),
  releaseDailyTask: vi.fn(async () => {}),
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
import { recordCompletedTask, recordModelCall, releaseDailyTask, reserveDailyTask } from "@/lib/meter-store";
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
    expect(message).toMatch(/Abrir formulario seguro/);
    expect(message.replace(/\[[^\]]*]\([^)]*\)/g, "enlace").split(/[.!?]+/).filter((part) => part.trim())).toHaveLength(3);
    expect(message).toMatch(/No las escribas en este chat/);
    expect(message).toMatch(/no inicia sesión/i);
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
    expect(sealChatText("La clave del F29 es el plazo de declaración.")).toBe(
      "La clave del F29 es el plazo de declaración.",
    );
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
    { name: "corta alfabética", text: "clave: hola", fragments: ["hola"] },
    { name: "password igual abc", text: "password=abc", fragments: ["abc"] },
    { name: "contraseña es verano", text: "contraseña es verano", fragments: ["verano"] },
    { name: "comillas", text: 'clave: "hola"', fragments: ["hola"] },
    { name: "comillas simples", text: "password='abc'", fragments: ["abc"] },
    { name: "comillas angulares", text: "clave: «verano»", fragments: ["verano"] },
    { name: "unicode", text: "clave: niño", fragments: ["niño"] },
    { name: "unicode largo", text: "password: パスワード", fragments: ["パスワード"] },
    { name: "varias líneas corta", text: "sigue el texto\nclave:\nhola", fragments: ["hola", "sigue el texto"] },
    { name: "clave del SII es hola", text: "Mi clave del SII es hola", fragments: ["hola"] },
    { name: "contraseña de la empresa es abc", text: "Mi contraseña de la empresa es abc", fragments: ["abc"] },
    { name: "contraseña unicode", text: "Mi contraseña del SII es パスワード", fragments: ["パスワード"] },
    { name: "clave con salto de línea", text: "Mi clave del SII es\nhola", fragments: ["hola"] },
    { name: "contraseña con salto de línea", text: "Mi contraseña de la empresa es\nabc", fragments: ["abc"] },
    { name: "contraseña es tu", text: "Mi contraseña del SII es tu", fragments: ["tu"] },
    { name: "contraseña citada la", text: "Mi contraseña de la empresa es «la»", fragments: ["«la»"] },
    { name: "contraseña con salto mi", text: "Mi contraseña del SII es\nmi", fragments: ["mi"] },
    { name: "clave es tu", text: "Mi clave del SII es tu", fragments: ["tu"] },
    { name: "contraseña frase funcional", text: "Mi contraseña del SII es la de invierno", fragments: ["invierno", "la de invierno"] },
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

  test("clave: hola y una asignación en varias líneas no dejan texto plano", () => {
    for (const text of ["clave: hola", "password=abc", "contraseña es verano", "sigue el IVA\nclave:\n«hola»"]) {
      const sealed = sealChatText(text);
      expect(sealed).toBe(SAFE_CREDENTIAL_ENTRY);
      expect(sealed).not.toContain("hola");
      expect(sealed).not.toContain("abc");
      expect(sealed).not.toContain("verano");
      expect(sealed).not.toContain("IVA");
    }
    expect(sealChatText("La clave del F29 es el plazo.")).toBe("La clave del F29 es el plazo.");
    expect(sealChatText("Mi clave del SII es la de siempre")).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(sealChatText("Mi clave del SII es esto")).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(sealChatText("Mi clave del SII es cuando")).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(sealChatText("La clave del éxito es tu")).toBe("La clave del éxito es tu");
  });
});

describe("turno de chat", () => {
  beforeEach(() => {
    vi.mocked(saveUserMessage).mockReset();
    vi.mocked(saveCountedAssistantMessage).mockReset();
    vi.mocked(loadHistory).mockReset();
    vi.mocked(createXaiClient).mockReset();
    vi.mocked(prismaCredentialRepo).mockClear();
    vi.mocked(reserveDailyTask).mockReset();
    vi.mocked(reserveDailyTask).mockResolvedValue({ ok: true, reservationId: null });
    vi.mocked(releaseDailyTask).mockReset();
    vi.mocked(recordCompletedTask).mockReset();
    vi.mocked(recordModelCall).mockReset();
    vi.mocked(saveUserMessage).mockImplementation(async ({ body }: { body: string }) => ({
      threadId: "thread-a",
      message: bubble("user-1", "USER", body),
    }));
    vi.mocked(saveCountedAssistantMessage).mockImplementation(async (_org: string, _thread: string, body: string) =>
      bubble("asst-1", "ASSISTANT", body),
    );
  });

  test("una clave en frase natural no se guarda, no va al modelo ni al log, y suelta el adjunto", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const file = { fileName: "nota.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: `Mi clave del SII es ${EXAMPLE}`,
      files: [file],
    })) {
      events.push(event);
    }
    const logged = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    spy.mockRestore();
    const packed = `${JSON.stringify(events)}\n${logged}\n${JSON.stringify(vi.mocked(saveUserMessage).mock.calls)}`;
    expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({ body: SAFE_CREDENTIAL_ENTRY, files: [] });
    expect(packed).not.toContain(EXAMPLE);
    expect(createXaiClient).not.toHaveBeenCalled();
    expect(loadHistory).not.toHaveBeenCalled();
    const assistant = events.find((event) => event.type === "message");
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toContain(
      "/panel/boveda?portal=sii#agregar-acceso",
    );
  });

  test("una asignación corta, unicode o con salto de línea no sale del compositor ni del turno", async () => {
    const pdf = { fileName: "nota.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    const cases = [
      { text: "Mi clave del SII es hola", secret: "hola" },
      { text: "Mi contraseña de la empresa es abc", secret: "abc" },
      { text: "Mi contraseña del SII es パスワード", secret: "パスワード" },
      { text: "Mi clave del SII es\nhola", secret: "hola" },
      { text: "Mi contraseña de la empresa es\nabc", secret: "abc" },
      { text: "Mi contraseña del SII es tu", secret: "tu" },
      { text: "Mi contraseña de la empresa es «la»", secret: "«la»" },
      { text: "Mi contraseña del SII es\nmi", secret: "mi" },
      { text: "Mi contraseña del SII es la de invierno", secret: "invierno" },
      { text: "Mi clave del SII es la de siempre", secret: "siempre" },
      { text: "Mi clave del SII es esto mismo", secret: "mismo" },
      { text: "Mi clave del SII es cuando llegue", secret: "llegue" },
      {
        text: `Mi contraseña de la cuenta del SII ${Array.from({ length: 20 }, () => "zona").join(" ")} es la de siempre`,
        secret: "siempre",
      },
    ];
    for (const item of cases) {
      const composer = prepareComposerTurn(item.text, [pdf]);
      expect(composer.text).toBe(SAFE_CREDENTIAL_ENTRY);
      expect(composer.files).toEqual([]);
      expect(composer.seal).toBe(true);
      expect(composer.text).not.toContain(item.secret);
      const alone = prepareModelTurn([{ role: "user", text: item.text }], "Bóveda (nunca la clave):");
      expect(alone.messages[0]?.text).toBe(SAFE_CREDENTIAL_ENTRY);
      expect(JSON.stringify(alone)).not.toContain(item.secret);
      const prepared = prepareModelTurn(
        [
          { role: "user", text: item.text },
          { role: "user", text: "¿Cuándo se paga el IVA de noviembre?" },
        ],
        "Bóveda (nunca la clave):",
      );
      expect(prepared.messages[0]?.text).toBe(SAFE_CREDENTIAL_ENTRY);
      expect(prepared.messages.at(-1)?.text).toBe("¿Cuándo se paga el IVA de noviembre?");
      expect(prepared.vaultNote).toBe("");
      expect(JSON.stringify(prepared)).not.toContain(item.secret);

      vi.mocked(saveUserMessage).mockClear();
      vi.mocked(createXaiClient).mockClear();
      vi.mocked(loadHistory).mockClear();
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const events = [];
      let logged = "";
      try {
        for await (const event of streamChatTurn({
          organizationId: "org-a",
          organizationName: "QA Interno",
          actorUserId: "user-a",
          text: item.text,
          files: [pdf],
        })) {
          events.push(event);
        }
        logged = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      } finally {
        spy.mockRestore();
      }
      const sent = JSON.stringify({ texto: composer.text, archivos: composer.files });
      const packed = `${sent}\n${JSON.stringify(events)}\n${logged}\n${JSON.stringify(vi.mocked(saveUserMessage).mock.calls)}\n${JSON.stringify(alone)}\n${JSON.stringify(prepared)}`;
      expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({ body: SAFE_CREDENTIAL_ENTRY, files: [] });
      expect(packed).not.toContain(item.text);
      expect(packed).not.toContain(JSON.stringify(item.text).slice(1, -1));
      // «la» y «mi» también aparecen en el texto fijo («de la Bóveda», «consentimiento»).
      // Se exige el valor citado o la palabra suelta, no esa coincidencia del aviso.
      if (item.secret === "mi") expect(packed).not.toMatch(/\bmi\b/i);
      else expect(packed).not.toContain(item.secret);
      expect(createXaiClient).not.toHaveBeenCalled();
      expect(loadHistory).not.toHaveBeenCalled();
    }
    expect(sealChatText("La clave del F29 es el plazo de declaración")).toBe(
      "La clave del F29 es el plazo de declaración",
    );
    expect(sealChatText("La clave del éxito es constancia.")).toBe("La clave del éxito es constancia.");
    expect(sealChatText("Mi clave del éxito es constancia.")).toBe("Mi clave del éxito es constancia.");
    expect(sealChatText("¿Cuándo se paga el IVA de noviembre?")).toBe("¿Cuándo se paga el IVA de noviembre?");
    expect(sealChatText("Mi clave del SII es la de siempre")).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(sealChatText("Mi clave del SII es esto")).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(sealChatText("Mi clave del SII es cuando")).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(sealChatText("La clave del éxito es tu")).toBe("La clave del éxito es tu");
    expect(sealChatText("Mi contraseña del SII es esto")).toBe(SAFE_CREDENTIAL_ENTRY);
    for (const length of [4, 8, 20, 40]) {
      const descriptor = Array.from({ length }, () => "zona").join(" ");
      const text = `Mi contraseña de la cuenta del SII ${descriptor} es la de siempre`;
      expect(sealChatText(text)).toBe(SAFE_CREDENTIAL_ENTRY);
      expect(prepareComposerTurn(text, ["nota.pdf"]).files).toEqual([]);
    }
    expect(
      sealChatText("Mi contraseña de la oficina Ñuñoa del SII\nde la sucursal oriente\nes la de siempre"),
    ).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(
      sealChatText("La clave del éxito es constancia. Mi contraseña de la cuenta del SII es la de siempre"),
    ).toBe(SAFE_CREDENTIAL_ENTRY);
  });

  test("un formulario o una factura llegan al modelo con su texto y su PDF", async () => {
    const pdf = { fileName: "f29.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    const review = "Respuesta de revisión de prueba.";
    for (const text of [
      "Revisa el formulario 29 del SII que te adjunto",
      "Te pego la factura; ¿cuál es la clave del crédito fiscal?",
      "Mi clave del éxito es constancia. Revisa el formulario que adjunto",
    ]) {
      vi.mocked(saveUserMessage).mockClear();
      vi.mocked(createXaiClient).mockClear();
      vi.mocked(loadHistory).mockResolvedValue([
        {
          role: "user",
          text,
          files: [{ name: pdf.fileName, mime: pdf.mimeType, note: `Archivo adjunto: ${pdf.fileName} (${pdf.mimeType}).` }],
        },
      ]);
      const seen: { text: string; note: string; instructions: string } = { text: "", note: "", instructions: "" };
      vi.mocked(createXaiClient).mockReturnValue({
        async respond() {
          throw new Error("no");
        },
        async *streamRespond(request: XaiRequest) {
          seen.instructions = request.instructions;
          const last = request.task.type === "agent_chat" ? request.task.messages.at(-1) : undefined;
          seen.text = last?.text ?? "";
          seen.note = last?.files?.map((file) => file.note ?? file.name).join("\n") ?? "";
          yield {
            type: "done" as const,
            response: {
              id: "rev",
              model: request.model,
              outputText: review,
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
        text,
        files: [pdf],
      })) {
        events.push(event);
      }
      expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({ body: text, files: [pdf] });
      expect(seen.text).toBe(text);
      expect(seen.note).toContain(pdf.fileName);
      expect(seen.instructions).not.toContain("Bóveda (solo id");
      expect(createXaiClient).toHaveBeenCalled();
      const packed = `${JSON.stringify(events)}\n${JSON.stringify(vi.mocked(saveUserMessage).mock.calls)}`;
      expect(packed).toContain(text);
      expect(packed).toContain(review);
      expect(packed).not.toContain("/panel/boveda");
      if (text.includes("crédito fiscal")) expect(packed).toContain("crédito fiscal");
    }
  });

  test("entrar, guardar un acceso o entregar una clave abre el formulario y no simula el ingreso", async () => {
    const pdf = { fileName: "nota.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    const cases = [
      { text: "Quiero entrar al SII", secret: false },
      { text: "Guarda mi acceso del SII", secret: false },
      { text: "Mi clave del SII es hola", secret: true },
    ];
    for (const item of cases) {
      vi.mocked(saveUserMessage).mockClear();
      vi.mocked(createXaiClient).mockClear();
      vi.mocked(loadHistory).mockClear();
      const events = [];
      for await (const event of streamChatTurn({
        organizationId: "org-a",
        organizationName: "QA Interno",
        actorUserId: "user-a",
        text: item.text,
        files: [pdf],
      })) {
        events.push(event);
      }
      const assistant = events.find((event) => event.type === "message");
      const body = assistant && assistant.type === "message" ? assistant.message.body : "";
      expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({
        body: SAFE_CREDENTIAL_ENTRY,
        files: item.secret ? [] : [pdf],
      });
      expect(body).toContain("/panel/boveda?portal=sii#agregar-acceso");
      expect(body).toMatch(/No las escribas en este chat/);
      expect(body).toMatch(/No entré al portal/);
      expect(body).not.toMatch(/pásame|escríbeme|Entr[eé] al SII|revis[eé] el|le[ií] el pdf/i);
      expect(JSON.stringify(events)).not.toContain("hola");
      expect(createXaiClient).not.toHaveBeenCalled();
      expect(loadHistory).not.toHaveBeenCalled();
    }
  });

  test("documento y credencial explícita no envían el valor ni el adjunto", async () => {
    const pdf = { fileName: "f29.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
    for (const item of [
      { text: "Revisa el formulario 29 del SII que te adjunto. Mi clave del SII es hola", secret: "hola" },
      { text: "Te pego la factura; mi contraseña de la empresa es abc", secret: "abc" },
    ]) {
      vi.mocked(saveUserMessage).mockClear();
      vi.mocked(createXaiClient).mockClear();
      const events = [];
      for await (const event of streamChatTurn({
        organizationId: "org-a",
        organizationName: "QA Interno",
        actorUserId: "user-a",
        text: item.text,
        files: [pdf],
      })) {
        events.push(event);
      }
      const assistant = events.find((event) => event.type === "message");
      const body = assistant && assistant.type === "message" ? assistant.message.body : "";
      const packed = `${JSON.stringify(events)}\n${JSON.stringify(vi.mocked(saveUserMessage).mock.calls)}`;
      expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({ body: SAFE_CREDENTIAL_ENTRY, files: [] });
      expect(packed).not.toContain(item.secret);
      expect(body).toContain("/panel/boveda");
      expect(body).toMatch(/No entré al portal/);
      expect(body).not.toMatch(/revis[eé] el|le[ií] el (pdf|archivo|formulario|documento)/i);
      expect(createXaiClient).not.toHaveBeenCalled();
    }
  });

  test("si la reserva del cupo falla mientras el historial sigue pendiente, no hay rechazo sin manejar", async () => {
    const reasons: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      reasons.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const failure = new Error("base de cupo no disponible");
      let rejectSlot: (error: Error) => void = () => {};
      let resolveHistory: (rows: { role: "user"; text: string }[]) => void = () => {};
      vi.mocked(reserveDailyTask).mockReturnValue(
        new Promise((_, reject) => {
          rejectSlot = reject;
        }),
      );
      vi.mocked(loadHistory).mockReturnValue(
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
      );
      const pending = (async () => {
        for await (const event of streamChatTurn({
          organizationId: "org-a",
          organizationName: "QA Interno",
          actorUserId: "user-a",
          text: IVA,
          files: [],
        })) {
          void event;
        }
      })();
      await new Promise((resolve) => setImmediate(resolve));
      rejectSlot(failure);
      await new Promise((resolve) => setImmediate(resolve));
      expect(reasons).toEqual([]);
      const assertion = expect(pending).rejects.toBe(failure);
      resolveHistory([{ role: "user", text: IVA }]);
      await assertion;
      await new Promise((resolve) => setImmediate(resolve));
      expect(reasons).toEqual([]);
      expect(createXaiClient).not.toHaveBeenCalled();
      expect(releaseDailyTask).not.toHaveBeenCalled();
      expect(recordCompletedTask).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("un F29 con PDF no se sella ni pierde el adjunto", async () => {
    vi.mocked(loadHistory).mockResolvedValue([{ role: "user", text: "Guarda el formulario 29 del SII" }]);
    vi.mocked(createXaiClient).mockReturnValue({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond() {
        yield {
          type: "done" as const,
          response: {
            id: "f29",
            model: "grok-4.7",
            outputText: "El F29 es la declaración mensual.",
            usage: USAGE_PRESETS.text,
            mocked: true,
          },
        };
      },
    });
    const file = { fileName: "f29.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2]) };
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: "Guarda el formulario 29 del SII",
      files: [file],
    })) {
      events.push(event);
    }
    expect(vi.mocked(saveUserMessage).mock.calls[0]?.[0]).toMatchObject({
      body: "Guarda el formulario 29 del SII",
      files: [file],
    });
    expect(createXaiClient).toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain("/panel/boveda");
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
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toMatch(/Abrir formulario seguro/);
    expect(assistant && assistant.type === "message" ? assistant.message.body : "").toMatch(/No entré al portal/);
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
    expect(releaseDailyTask).not.toHaveBeenCalled();
  });

  test("si se corta la respuesta, se suelta la reserva y no queda la tarea", async () => {
    vi.mocked(reserveDailyTask).mockResolvedValue({ ok: true, reservationId: "reserva-chat" });
    vi.mocked(loadHistory).mockResolvedValue([{ role: "user", text: IVA }]);
    const controller = new AbortController();
    vi.mocked(createXaiClient).mockReturnValue({
      async respond() {
        throw new Error("no debía usar respond");
      },
      async *streamRespond() {
        controller.abort();
        yield { type: "delta" as const, text: "alcancé a empezar" };
      },
    });
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: IVA,
      files: [],
      signal: controller.signal,
    })) {
      events.push(event);
    }
    expect(releaseDailyTask).toHaveBeenCalledWith("reserva-chat");
    expect(recordCompletedTask).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  test("una respuesta incompleta no se cobra como tarea hecha", async () => {
    vi.mocked(reserveDailyTask).mockResolvedValue({ ok: true, reservationId: "reserva-corta" });
    vi.mocked(loadHistory).mockResolvedValue([{ role: "user", text: "Haz el cálculo del IVA" }]);
    vi.mocked(createXaiClient).mockReturnValue({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond() {
        yield { type: "delta" as const, text: "El 19% es una parte." };
        yield {
          type: "done" as const,
          response: {
            id: "corta",
            model: "grok-4.7",
            outputText: "El 19% es una parte.",
            usage: { inputTokens: 19, cachedTokens: 4, outputTokens: 6 },
            mocked: false,
            incomplete: true,
          },
        };
      },
    });
    const events = [];
    for await (const event of streamChatTurn({
      organizationId: "org-a",
      organizationName: "QA Interno",
      actorUserId: "user-a",
      text: "Haz el cálculo del IVA",
      files: [],
    })) {
      events.push(event);
    }
    const saved = events.find((event) => event.type === "message");
    const body = saved && saved.type === "message" ? saved.message.body : "";
    expect(body).toContain("El 19% es una parte.");
    expect(body).toContain("(Respuesta incompleta por el límite de salida.)");
    expect(body).not.toMatch(/pide detalle|cancel|reembol/i);
    expect(recordModelCall).toHaveBeenCalledWith({
      organizationId: "org-a",
      response: {
        model: "grok-4.7",
        usage: { inputTokens: 19, cachedTokens: 4, outputTokens: 6 },
        mocked: false,
      },
    });
    expect(recordCompletedTask).not.toHaveBeenCalled();
    expect(releaseDailyTask).toHaveBeenCalledWith("reserva-corta");
  });

  test("sin cupo diario no llama al modelo", async () => {
    vi.mocked(reserveDailyTask).mockResolvedValue({ ok: false, reason: "limite" });
    vi.mocked(loadHistory).mockResolvedValue([{ role: "user", text: IVA }]);
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
    expect(events).toContainEqual({ type: "error", code: "limite" });
    expect(createXaiClient).not.toHaveBeenCalled();
    expect(releaseDailyTask).not.toHaveBeenCalled();
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
