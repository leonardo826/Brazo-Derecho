import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ChatMarkdown } from "@/components/chat-markdown";
import { attachmentScope, prepareUpload, safeFileName } from "@/lib/chat/files";
import { parseMarkdown, safeHref } from "@/lib/chat/markdown";
import { ACTION_HELP, type PublicMessage } from "@/lib/chat/public";
import { sensitiveRequest, splitAction, vaultActionFor, wantsPortalAccess } from "@/lib/chat/sensitive";
import { replaceOptimisticUser } from "@/lib/chat/thread";
import { hideActionMarker, plainSpeech } from "@/lib/chat/visible";
import { chatContent, modelInput, validImageDataUrl } from "@/lib/xai/chat-input";
import { mapXaiStreamEvent, readSseData } from "@/lib/xai/parse";
import type { XaiTask } from "@/lib/xai/types";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function message(partial: Pick<PublicMessage, "id" | "role" | "body"> & Partial<PublicMessage>): PublicMessage {
  return {
    kind: "TEXT",
    action: "",
    actionTitle: "",
    confirmation: null,
    createdAt: "2026-11-05T11:20:00.000Z",
    attachments: [],
    ...partial,
  };
}

function chat(text: string, files?: { name: string; mime: string; imageDataUrl?: string; note?: string }[]): Extract<XaiTask, { type: "agent_chat" }> {
  return {
    type: "agent_chat",
    today: "5 de noviembre de 2026",
    messages: [{ role: "user", text, files }],
  };
}

describe("chat continuo", () => {
  test("pide confirmación para presentar, pagar o una herramienta de riesgo", () => {
    expect(sensitiveRequest("Presenta el F29 de octubre")?.id).toBe("presentar_declaracion");
    expect(sensitiveRequest("Quiero que presentes la declaración de renta")?.id).toBe("presentar_declaracion");
    expect(sensitiveRequest("Paga las cotizaciones")?.id).toBe("pagar");
    expect(sensitiveRequest("¿Puedes pagar el PPM?")?.id).toBe("pagar");
    expect(sensitiveRequest("Transfiere el IVA a Tesorería")?.id).toBe("pagar");
    expect(sensitiveRequest("Entra al SII con mi clave")).toBeNull();
    expect(sensitiveRequest("Entra al SII a revisar ventas")).toBeNull();
    expect(sensitiveRequest("Borra toda la base")?.id).toBe("herramienta");
    expect(wantsPortalAccess("Entra al SII con mi clave de la bóveda")).toBe(true);
    expect(wantsPortalAccess("Entra al SII a revisar ventas")).toBe(true);
    expect(wantsPortalAccess("¿Cuándo se paga el IVA?")).toBe(false);
    expect(wantsPortalAccess("¿Cómo se registran las ventas en el SII?")).toBe(false);
    expect(wantsPortalAccess("Presenta el F29 de octubre")).toBe(false);
    expect(wantsPortalAccess("Quiero entrar al SII")).toBe(true);
    expect(wantsPortalAccess("Revisa el formulario 29 del SII que te adjunto")).toBe(false);
  });

  test("una duda no abre una tarjeta de confirmación", () => {
    expect(sensitiveRequest("¿Cuándo se paga el IVA?")).toBeNull();
    expect(sensitiveRequest("¿Qué pasa si presento el F29 atrasado?")).toBeNull();
    expect(sensitiveRequest("Explícame el plazo para pagar el PPM")).toBeNull();
    expect(sensitiveRequest("Explícame cómo presentar el F29")).toBeNull();
    expect(sensitiveRequest("Explícame quién presenta el F29")).toBeNull();
    expect(sensitiveRequest("¿Quién presenta el F29?")).toBeNull();
    expect(sensitiveRequest("Explícame cómo se envía la declaración")).toBeNull();
    expect(sensitiveRequest("Explícame quién paga el IVA")).toBeNull();
    expect(sensitiveRequest("Explícame cómo pagar el IVA")).toBeNull();
    expect(sensitiveRequest("Explícame cómo borrar toda la base")).toBeNull();
    expect(sensitiveRequest("Solo quiero preguntar si se puede presentar el F29, no inicies")).toBeNull();
    expect(sensitiveRequest("No presentes el F29")).toBeNull();
    expect(sensitiveRequest("No presenta el F29")).toBeNull();
    expect(sensitiveRequest("No pagues el IVA")).toBeNull();
    expect(sensitiveRequest('El manual dice “presenta el F29”')).toBeNull();
    expect(sensitiveRequest('El manual dice "paga el IVA"')).toBeNull();
    expect(sensitiveRequest("Presenta el F29 de octubre")?.id).toBe("presentar_declaracion");
    expect(sensitiveRequest("Presenta el F29 de octubre y explícame el resultado")?.id).toBe("presentar_declaracion");
    expect(sensitiveRequest("Envía la declaración y explícame cómo")?.id).toBe("presentar_declaracion");
    expect(sensitiveRequest("Paga el IVA y explícame el comprobante")?.id).toBe("pagar");
    expect(sensitiveRequest("Borra toda la base y explícame qué hiciste")?.id).toBe("herramienta");
    expect(sensitiveRequest('Presenta el F29; el documento dice “no inicies”')?.id).toBe("presentar_declaracion");
  });

  test("aprobar en el hilo deja la misma confirmación que la bóveda", () => {
    expect(vaultActionFor("presentar_declaracion")).toBe("DECLARAR");
    expect(vaultActionFor("pagar")).toBe("PAGAR");
    expect(vaultActionFor("herramienta")).toBeNull();
  });

  test("saca la acción del texto visible", () => {
    const split = splitAction("Borrador listo.\nACCION_SENSIBLE: pagar\nTITULO: Pagar cotizaciones\nDETALLE: No sale plata.");
    expect(split.text).toBe("Borrador listo.");
    expect(split.action).toMatchObject({ id: "pagar", title: "Pagar cotizaciones" });
    expect(hideActionMarker("Hola ACCION_SENSIBLE: pagar")).toBe("Hola");
  });

  test("un envío deja una sola burbuja de usuario al llegar el mensaje guardado", () => {
    const text = "Prueba móvil: di hola en una frase.";
    const optimistic = message({ id: "local-1", role: "USER", body: text });
    const saved = message({ id: "db-1", role: "USER", body: text, createdAt: "2026-11-05T11:20:01.000Z" });
    const history = [
      message({ id: "db-0", role: "USER", body: "¿Cuándo vence el F29?" }),
      message({ id: "db-a", role: "ASSISTANT", body: "El 12 del mes siguiente." }),
      optimistic,
    ];
    // El composer guarda el id y limpia el ref antes de que React ejecute el updater.
    let tempId = optimistic.id;
    const localId = tempId;
    tempId = "";
    const next = replaceOptimisticUser(history, saved, localId);
    expect(tempId).toBe("");
    expect(next.filter((item) => item.role === "USER" && item.body === text)).toHaveLength(1);
    expect(next.map((item) => item.id)).toEqual(["db-0", "db-a", "db-1"]);
  });

  test("dos envíos distintos con el mismo texto siguen siendo dos burbujas", () => {
    const first = message({ id: "db-1", role: "USER", body: "hola" });
    const second = message({ id: "db-2", role: "USER", body: "hola", createdAt: "2026-11-05T11:21:00.000Z" });
    expect(replaceOptimisticUser([first], second).map((item) => item.id)).toEqual(["db-1", "db-2"]);
  });

  test("las citas [[n]](url) se renderizan como enlace", () => {
    const text = "El F29 vence el 12 [[1]](https://www.sii.cl/normativa) y el PPM el 20 [[2]](https://www.sii.cl/ppm).";
    const html = renderToStaticMarkup(createElement(ChatMarkdown, { text }));
    expect(html).toContain('href="https://www.sii.cl/normativa"');
    expect(html).toContain('href="https://www.sii.cl/ppm"');
    expect(html).toContain(">1</a>");
    expect(html).toContain(">2</a>");
    expect(html).not.toContain("[[1]]");
    expect(html).not.toContain("[[2]]");
    const hostile = renderToStaticMarkup(
      createElement(ChatMarkdown, { text: "ver [[1]](javascript:alert(1))" }),
    );
    expect(hostile).not.toContain("javascript:");
    expect(hostile).not.toContain("href=");
  });

  test("el markdown no interpreta HTML ni enlaces javascript", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>\n\n[ficha](javascript:alert(1))\n\n[SII](https://www.sii.cl)");
    const dumped = JSON.stringify(blocks);
    expect(dumped).toContain("<script>alert(1)</script>");
    expect(dumped).not.toContain('"href":"javascript:');
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("/panel/boveda")).toBe("/panel/boveda");
    expect(safeHref("//panel/boveda")).toBe("");
    expect(safeHref("/panel/boveda?portal=sii#agregar-acceso")).toBe("/panel/boveda?portal=sii#agregar-acceso");
    expect(safeHref("/panel/boveda?portal=sii&clave=secreto")).toBe("");
    expect(safeHref("/panel/boveda?next=https://evil.example")).toBe("");
    expect(ACTION_HELP.toLowerCase()).not.toContain("no uso claves");
    const vaultLink = renderToStaticMarkup(createElement(ChatMarkdown, { text: "Guárdala en la [Bóveda](/panel/boveda)." }));
    expect(vaultLink).toContain('href="/panel/boveda"');
    expect(vaultLink).not.toContain('target="_blank"');
    expect(blocks.some((block) => block.type === "paragraph" && block.children.some((node) => node.type === "link" && node.href.startsWith("https://www.sii.cl")))).toBe(true);
  });

  test("guarda solo archivos reconocibles y con nombre seguro", () => {
    expect(prepareUpload("../../notas.txt", new TextEncoder().encode("hola"))?.fileName).toBe("notas.txt");
    expect(prepareUpload("foto.png", png)?.mimeType).toBe("image/png");
    expect(prepareUpload("virus.png", new Uint8Array([0x4d, 0x5a, 0, 0]))).toBeNull();
    expect(prepareUpload("logo.svg", new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(safeFileName("a/b/c.pdf")).toBe("c.pdf");
    expect(attachmentScope("org-1", "file-1")).toEqual({
      id: "file-1",
      organizationId: "org-1",
      message: { thread: { organizationId: "org-1" } },
    });
  });

  test("la imagen va al modelo y un data url inválido no", () => {
    const url = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    expect(validImageDataUrl(url)).toBe(true);
    const payload = JSON.stringify(modelInput(chat("mira", [{ name: "foto.png", mime: "image/png", imageDataUrl: url }])));
    expect(payload).toContain("input_image");
    expect(payload).toContain(url);
    const hostile = JSON.stringify(
      chatContent(chat("mira", [{ name: "foto.png", mime: "image/png", imageDataUrl: "javascript:alert(1)" }])),
    );
    expect(hostile).not.toContain("javascript:");
  });

  test("lee los tokens del stream de xAI", async () => {
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"Hola "}',
      "",
      'data: {"type":"response.web_search_call.searching"}',
      "",
      'data: {"type":"response.output_text.delta","delta":"Chile"}',
      "",
      'data: {"type":"response.completed","response":{"id":"resp_9","model":"grok-4.7","output_text":"Hola Chile","usage":{"input_tokens":10,"output_tokens":2,"input_tokens_details":{"cached_tokens":1}}}}',
      "",
    ].join("\n");
    const events = [];
    for await (const raw of readSseData(new Response(sse).body!)) events.push(mapXaiStreamEvent(raw));
    expect(events.map((event) => event?.type)).toEqual(["delta", "status", "delta", "done"]);
    expect(events[0]).toMatchObject({ text: "Hola " });
    expect(events[1]).toMatchObject({ text: "Buscando la norma vigente…" });
    expect(events[3]).toMatchObject({
      response: { id: "resp_9", outputText: "Hola Chile", usage: { inputTokens: 10, cachedTokens: 1, outputTokens: 2 } },
    });
    expect(plainSpeech("**Hola** [SII](https://www.sii.cl)")).toBe("Hola SII");
  });
});
