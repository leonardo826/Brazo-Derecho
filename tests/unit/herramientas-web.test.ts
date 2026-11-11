import { describe, expect, test, vi } from "vitest";
import { composeAnswer, dropProgressNarration, isImagePayload, withSources } from "@/lib/chat/answer";
import { normalizeSections } from "@/lib/chat/markdown";
import { chatInstructions, chatSurface } from "@/lib/chat/agents";
import { accountantChatInstructions } from "@/lib/chat/accountant";
import { billedToolUse, messageAsksImage, messageNeedsWeb, readToolReport, toolsForAgent } from "@/lib/chat/tools";
import { LiveXaiClient, requestTools, xaiErrorDetail } from "@/lib/xai/live";
import { mapXaiStreamEvent } from "@/lib/xai/parse";
import { USAGE_PRESETS } from "@/lib/pricing";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");

describe("herramientas de la web", () => {
  test("los tres agentes buscan un sitio y solo Marketing pide imagen", () => {
    const site = "Entra a www.tecna-zinc.cl y resume qué venden";
    expect(messageNeedsWeb(site)).toBe(true);
    expect(messageNeedsWeb("hola")).toBe(false);
    for (const agent of ["ACCOUNTING", "MARKETING", "WHATSAPP"] as const) {
      expect(chatSurface(agent).webSearch).toBe(true);
      expect(chatSurface(agent).xSearch).toBe(false);
      expect(toolsForAgent(agent, 20).some((tool) => tool.type === "web_search")).toBe(true);
      expect(toolsForAgent(agent, 20).some((tool) => tool.type === "x_search")).toBe(false);
    }
    expect(toolsForAgent("ACCOUNTING", 20)).toEqual([{ type: "web_search" }]);
    const image = "Prepárame una imagen publicitaria para las redes";
    expect(messageAsksImage(image)).toBe(true);
    expect(messageNeedsWeb(site)).toBe(true);
    expect(toolsForAgent("MARKETING", 20).map((tool) => tool.type)).toEqual(["web_search", "image_generation"]);
    expect(toolsForAgent("MARKETING", 0).map((tool) => tool.type)).toEqual(["web_search"]);
    expect(toolsForAgent("ACCOUNTING", 20).some((tool) => tool.type === "image_generation")).toBe(false);
  });

  test("el cliente manda web_search e image_generation, y no manda x_search", async () => {
    expect(
      requestTools({
        model: "grok-4.7",
        instructions: "instrucciones",
        usage: USAGE_PRESETS.text,
        webSearch: true,
        imageGeneration: true,
        task: { type: "agent_chat", today: "hoy", messages: [{ role: "user", text: "imagen" }] },
      }),
    ).toEqual([{ type: "web_search" }, { type: "image_generation" }]);
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.tools.some((tool: { type: string }) => tool.type === "x_search")).toBe(false);
      const sse =
        'data: {"type":"response.output_item.added","item":{"type":"web_search_call"}}\n\n' +
        'data: {"type":"response.output_text.delta","delta":"Según https://tecna-zinc.cl"}\n\n' +
        `data: {"type":"response.completed","response":{"id":"r","output_text":"Según https://tecna-zinc.cl","usage":{"input_tokens":4,"output_tokens":2,"server_side_tool_usage":{"web_search_calls":2}},"output":[{"type":"web_search_call"},{"type":"web_search_call"}]}}\n\n`;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const client = new LiveXaiClient({ apiKey: "clave", baseUrl: "https://api.x.ai/v1", fetchImpl });
    const events = [];
    for await (const event of client.streamRespond({
      model: "grok-4.7",
      instructions: "instrucciones",
      usage: USAGE_PRESETS.text,
      webSearch: true,
      task: { type: "agent_chat", today: "hoy", messages: [{ role: "user", text: "www.tecna-zinc.cl" }] },
    })) {
      events.push(event);
    }
    const done = events.find((event) => event.type === "done");
    expect(done && done.type === "done" && done.response.webSearchCalls).toBe(2);
  });

  test("una imagen generada se guarda y la búsqueda suma al cupo; QA no se cobra", () => {
    const report = readToolReport({
      usage: { server_side_tool_usage: { web_search_calls: 1 } },
      output: [{ type: "image_generation_call", result: PNG }],
    });
    expect(report.webSearchCalls).toBe(1);
    expect(report.images).toHaveLength(1);
    expect(report.images[0]?.mimeType).toBe("image/png");
    expect(billedToolUse(false, 1, 1)).toEqual({ reply: 1, searches: 1, images: 1 });
    expect(billedToolUse(true, 3, 2)).toEqual({ reply: 0, searches: 0, images: 0 });
    const parsed = mapXaiStreamEvent({
      type: "response.completed",
      response: { id: "r", output_text: "Listo", usage: { server_side_tool_usage: { web_search_calls: 1 } }, output: [] },
    });
    expect(parsed?.type === "done" && parsed.response.webSearchCalls).toBe(1);
    const denied = xaiErrorDetail(403, JSON.stringify({ error: { message: "Your API key does not have access to web_search. sk-supersecreto" } }));
    expect(denied).toBe("xAI 403: Your API key does not have access to web_search. [clave]");
    expect(denied).not.toContain("sk-supersecreto");
  });

  test("el prompt cita la fuente, no supone la ciudad y no pisa un sitio nombrado", () => {
    for (const agent of ["ACCOUNTING", "MARKETING", "WHATSAPP"] as const) {
      const prompt = chatInstructions(agent, "Torre San Isidro");
      expect(prompt).toMatch(/exactamente lo pedido/i);
      expect(prompt).toMatch(/solo ida/i);
      expect(prompt).toMatch(/por encima del perfil guardado/i);
      expect(prompt).toMatch(/No supongas en silencio/);
      expect(prompt).toMatch(/cita la URL/i);
      expect(prompt).toMatch(/fuera de tu especialidad/i);
    }
    const marketing = chatInstructions("MARKETING", "Torre San Isidro");
    expect(marketing).toMatch(/no uses el perfil guardado/);
    expect(marketing).toMatch(/sin logos de marcas ajenas/);
    expect(marketing).toMatch(/la imagen va adjunta/);
    expect(marketing).toMatch(/idea de imagen/);
    expect(marketing).toMatch(/línea en blanco/);
    expect(marketing).toMatch(/No escribas «supuse que/);
    const contador = accountantChatInstructions("Torre San Isidro");
    expect(contador).toMatch(/solo la ida/);
    expect(contador).toMatch(/búsqueda web/);
    expect(chatInstructions("ACCOUNTING", "Torre San Isidro")).toMatch(/solo va si la respuesta es contable/);
    const whatsapp = chatInstructions("WHATSAPP", "Torre San Isidro");
    expect(whatsapp).toMatch(/clima/);
    expect(whatsapp).toMatch(/No inventes precios ni stock/);
    expect(whatsapp).not.toMatch(/Usa solo el nombre/);
    expect(contador).toMatch(/hora de llegada/);
  });

  test("el avance de la herramienta no queda en la respuesta y las citas son fuentes", () => {
    const glued = "El vuelo es el 12 de noviembre de 2026.Necesito horarios concretos.Reviso las tablas de ese día.Confirmo.LATAM sale a las 08:10 y llega a las 09:25.";
    expect(dropProgressNarration(glued)).toBe("El vuelo es el 12 de noviembre de 2026. LATAM sale a las 08:10 y llega a las 09:25.");
    const answer = composeAnswer({
      output_text: "Necesito el clima.Mañana hay 18 grados. 1 2",
      citations: ["https://www.meteochile.gob.cl/clima"],
      output: [
        { type: "message", content: [{ type: "output_text", text: "Necesito el clima de mañana." }] },
        { type: "web_search_call" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Reviso el pronóstico. Mañana en Concepción hay 18 grados [[1]](https://www.meteochile.gob.cl/clima).\n1 2",
            },
          ],
        },
      ],
    });
    expect(answer).toContain("Mañana en Concepción hay 18 grados");
    expect(answer).not.toMatch(/Necesito/);
    expect(answer).not.toMatch(/Reviso/);
    expect(answer).not.toMatch(/\[\[1\]\]/);
    expect(answer).not.toMatch(/\n1 2$/);
    expect(answer).toContain("Fuentes:");
    expect(answer).toContain("[meteochile.gob.cl](https://www.meteochile.gob.cl/clima)");
    const leaked = composeAnswer({
      output_text: "Faltan llegadas. El jueves 12 hay un LATAM.",
      output: [
        { type: "message", content: [{ type: "output_text", text: "Faltan llegadas y si hay tarifa de ese jueves." }] },
        { type: "web_search_call" },
        { type: "message", content: [{ type: "output_text", text: "Sigo buscando la tarifa." }] },
        { type: "message", content: [{ type: "output_text", text: "Faltan llegadas y si hay tarifa de ese jueves. El jueves 12, LATAM sale a las 09:24 y llega a las 10:32." }] },
      ],
    });
    expect(leaked).not.toMatch(/Faltan/);
    expect(leaked).not.toMatch(/Sigo buscando/);
    expect(leaked).toContain("LATAM sale a las 09:24");
    const cited = withSources(
      "LATAM LA8: 09:24–10:32. [LATAM](https://www.latam.com/vuelo). Fuente: https://www.latam.com/otro",
      ["https://latam.com/a", "https://www.latam.com/b", "https://www.skyairline.com/c"],
    );
    expect(cited).toContain("[(fuente)](https://www.latam.com/vuelo)");
    expect(cited).not.toMatch(/\[LATAM\]/);
    expect(cited).not.toMatch(/Fuente: https?:/);
    const fuentes = cited.split("Fuentes:")[1] ?? "";
    expect(fuentes.split("\n").filter((line) => line.includes("latam.com"))).toHaveLength(1);
    expect(cited).toContain("skyairline.com");
    const post = normalizeSections("Gancho: Mira. Cuerpo: El texto. Llamado a la acción: Escribe. Hashtags: #Concepción. Idea de imagen: Un taller.");
    expect(post).toContain("\n\nCuerpo:");
    expect(post).toContain("\n\nLlamado a la acción:");
    expect(post).toContain("\n\nHashtags:");
    expect(post).toContain("\n\nIdea de imagen:");
    const blob = "A".repeat(2_100);
    expect(isImagePayload(`data:image/png;base64,${blob}`)).toBe(true);
    expect(mapXaiStreamEvent({ type: "response.output_text.delta", delta: blob })?.type).toBe("status");
  });
});
