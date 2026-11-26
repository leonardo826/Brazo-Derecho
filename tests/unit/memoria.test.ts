import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { routineModel } from "@/lib/catalog";
import {
  MEMORY_HEADER,
  erasedFactData,
  estimateTokens,
  factHash,
  formatMemoryContext,
  isNearDuplicate,
  parseMemoryPayload,
  planMemoryWrites,
  selectFactsForPrompt,
} from "@/lib/memory/facts";
import { containsBlockedSecret, redactForExtraction } from "@/lib/memory/filter";
import { memoryFeatureEnabled } from "@/lib/memory/flag";
import { heuristicFacts, heuristicMemoryJson } from "@/lib/memory/heuristic";
import { extractionInput } from "@/lib/memory/service";
import { computeRutDv, formatRut } from "@/lib/rut";
import { LiveXaiClient } from "@/lib/xai/live";
import { MockXaiClient } from "@/lib/xai/mock";

const rut = formatRut(`76123456${computeRutDv("76123456")}`);

describe("interruptor de memoria", () => {
  test("solo la cadena exacta true lo enciende", () => {
    expect(memoryFeatureEnabled({})).toBe(false);
    expect(memoryFeatureEnabled({ MEMORY_FEATURE_ENABLED: "True" })).toBe(false);
    expect(memoryFeatureEnabled({ MEMORY_FEATURE_ENABLED: "1" })).toBe(false);
    expect(memoryFeatureEnabled({ MEMORY_FEATURE_ENABLED: " true" })).toBe(false);
    expect(memoryFeatureEnabled({ MEMORY_FEATURE_ENABLED: "true" })).toBe(true);
  });
});

describe("filtro de secretos", () => {
  test("deja pasar datos de la empresa y rechaza claves, tarjetas y llaves", () => {
    expect(containsBlockedSecret(`El RUT de la empresa es ${rut}.`)).toBe(false);
    expect(containsBlockedSecret("La empresa se llama Ferretería Los Aromos.")).toBe(false);
    expect(containsBlockedSecret("El rubro es ferretería.")).toBe(false);
    expect(containsBlockedSecret("Los productos son tornillos y pintura.")).toBe(false);
    expect(containsBlockedSecret("El tono que prefieren es cercano.")).toBe(false);
    expect(containsBlockedSecret("La clave del F29 es el plazo.")).toBe(false);

    expect(containsBlockedSecret("La contraseña del banco es verano2024.")).toBe(true);
    expect(containsBlockedSecret("password=hunter2")).toBe(true);
    expect(containsBlockedSecret("La clave del SII es sol12345.")).toBe(true);
    expect(containsBlockedSecret("La tarjeta es 4111 1111 1111 1111.")).toBe(true);
    expect(containsBlockedSecret("La llave es sk-abcDEF1234567890.")).toBe(true);
    expect(containsBlockedSecret("api_key: xai-abc123456789")).toBe(true);
    expect(containsBlockedSecret("Authorization: Bearer abcdef123456")).toBe(true);
  });

  test("el texto que ve el modelo no lleva la clave ni la tarjeta", () => {
    expect(redactForExtraction("La clave del SII es sol12345.")).toBe("[omitido: el mensaje trae una clave]");
    expect(redactForExtraction("El cupo de la tarjeta 4111111111111111 está al día.")).not.toContain("4111");
    expect(redactForExtraction(`El RUT es ${rut}.`)).toContain(rut);
  });
});

describe("hechos durables", () => {
  test("no repite un dato igual, uno con tilde o uno ya borrado", () => {
    const kept = "El rubro es panadería.";
    const existing = [
      { id: "activo", text: kept, contentHash: factHash(kept), deletedAt: null },
      {
        id: "borrado",
        text: "",
        contentHash: factHash("La empresa se llama Los Aromos."),
        deletedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ];
    const plan = planMemoryWrites({
      existing,
      organizationId: "org-a",
      agent: "MARKETING",
      sourceConversationId: "hilo-1",
      candidates: [
        { text: "el rubro es panaderia", scope: "empresa" },
        { text: "La empresa se llama Los Aromos.", scope: "empresa" },
        { text: "El tono que prefieren es cercano y breve.", scope: "agente" },
        { text: "La tarjeta es 4111111111111111.", scope: "empresa" },
        { text: "Los productos son pan amasado y empanadas.", scope: "empresa" },
      ],
    });
    expect(plan.inserts.map((row) => row.text)).toEqual([
      "El tono que prefieren es cercano y breve.",
      "Los productos son pan amasado y empanadas.",
    ]);
    expect(plan.inserts[0]?.agent).toBe("MARKETING");
    expect(plan.inserts[1]?.agent).toBeNull();
    expect(plan.inserts[1]?.sourceConversationId).toBe("hilo-1");
    expect(isNearDuplicate("El rubro es panadería.", "el rubro es panaderia.")).toBe(true);
  });

  test("alarga un dato más corto y no pasa el cupo de activos", () => {
    const short = "La empresa se llama Los Aromos.";
    const full = Array.from({ length: 2 }, (_, index) => {
      const text = `Dato durable número ${index} de la empresa local.`;
      return { id: `id-${index}`, text, contentHash: factHash(text), deletedAt: null };
    });
    const plan = planMemoryWrites({
      existing: [{ id: "nombre", text: short, contentHash: factHash(short), deletedAt: null }, ...full],
      organizationId: "org-a",
      agent: "ACCOUNTING",
      sourceConversationId: null,
      activeLimit: 3,
      candidates: [
        { text: "La empresa se llama Ferretería Los Aromos.", scope: "empresa" },
        { text: "El rubro es ferretería.", scope: "empresa" },
      ],
    });
    expect(plan.replacements).toEqual([
      {
        id: "nombre",
        text: "La empresa se llama Ferretería Los Aromos.",
        contentHash: factHash("La empresa se llama Ferretería Los Aromos."),
      },
    ]);
    expect(plan.inserts).toHaveLength(0);
  });

  test("elige lo relevante y no pasa el tope de tokens", () => {
    const facts = [
      {
        id: "horario",
        text: "El horario de invierno parte a las nueve.",
        agent: null,
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        id: "pintura",
        text: "Venden pintura blanca para interior.",
        agent: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    const header = estimateTokens(MEMORY_HEADER);
    const paintCost = estimateTokens("- Venden pintura blanca para interior.") + 1;
    const picked = selectFactsForPrompt(facts, "necesito pintura para el local", header + paintCost);
    expect(picked.map((fact) => fact.id)).toEqual(["pintura"]);
    expect(estimateTokens(formatMemoryContext(picked))).toBeLessThanOrEqual(header + paintCost);
    expect(selectFactsForPrompt(facts, "", 1000).map((fact) => fact.id)[0]).toBe("horario");
  });

  test("lee el JSON del modelo y bota el secreto", () => {
    const raw = [
      "```json",
      JSON.stringify({
        hechos: [
          { texto: "La tarjeta es 4111111111111111.", alcance: "empresa" },
          { texto: "El rubro es panadería.", alcance: "empresa" },
          { texto: "El tono que prefieren es formal.", alcance: "agente" },
        ],
      }),
      "```",
    ].join("\n");
    const parsed = parseMemoryPayload(raw);
    const plan = planMemoryWrites({
      existing: [],
      candidates: parsed,
      organizationId: "org-a",
      agent: "WHATSAPP",
      sourceConversationId: "conv-1",
    });
    expect(plan.inserts.map((row) => row.text)).toEqual([
      "El rubro es panadería.",
      "El tono que prefieren es formal.",
    ]);
    expect(plan.inserts[1]?.agent).toBe("WHATSAPP");
  });

  test("borrar deja el texto vacío y conserva la marca", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(erasedFactData(now)).toEqual({ deletedAt: now, text: "" });
  });
});

describe("extractor", () => {
  test("el simulador anota la empresa y no copia la clave", async () => {
    const turn = [
      "La empresa se llama Ferretería Los Aromos.",
      `El RUT es ${rut}.`,
      "El rubro es ferretería.",
      "Vendemos tornillos y pintura.",
      "Preferimos un tono cercano.",
      "La preferencia es tutear.",
      "La clave del SII es sol12345.",
    ].join(" ");
    const facts = heuristicFacts(turn).map((fact) => fact.text);
    expect(facts.some((fact) => fact.includes("Ferretería Los Aromos"))).toBe(true);
    expect(facts.some((fact) => fact.includes(rut))).toBe(true);
    expect(facts.some((fact) => fact.includes("ferretería"))).toBe(true);
    expect(facts.some((fact) => fact.includes("tornillos"))).toBe(true);
    expect(facts.some((fact) => /tono/i.test(fact))).toBe(true);
    expect(facts.join(" ")).not.toMatch(/sol12345|clave del SII/i);
    const response = await new MockXaiClient().respond({
      model: routineModel(),
      instructions: "Extrae JSON.",
      task: { type: "memory_extract", turn },
      usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 10 },
    });
    expect(response.mocked).toBe(true);
    expect(response.outputText).toBe(heuristicMemoryJson(turn));
    expect(JSON.parse(response.outputText).hechos.some((item: { texto: string }) => item.texto.includes("sol12345"))).toBe(
      false,
    );
  });

  test("la llamada barata usa el modelo habitual y no manda la clave", async () => {
    const previous = process.env.XAI_MODEL_ROUTINE;
    process.env.XAI_MODEL_ROUTINE = "grok-4.3";
    const input = extractionInput({
      agent: "ACCOUNTING",
      userText: "La clave del SII es sol12345. La empresa se llama Los Aromos.",
      assistantText: "No guardo claves.",
      known: ["El rubro es ferretería."],
    });
    expect(input).not.toContain("sol12345");
    expect(input).toContain("[omitido: el mensaje trae una clave]");
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        instructions: string;
        input: string;
        tools?: unknown;
        reasoning: { effort: string };
      };
      expect(body.model).toBe("grok-4.3");
      expect(body.tools).toBeUndefined();
      expect(body.reasoning.effort).toBe("low");
      expect(body.instructions).toContain("JSON");
      expect(body.input).not.toContain("sol12345");
      return new Response(JSON.stringify({ id: "resp_mem", model: "grok-4.3", output_text: '{"hechos":[]}' }), {
        status: 200,
      });
    };
    const response = await new LiveXaiClient({
      apiKey: "xai-test",
      baseUrl: "https://api.x.ai/v1",
      fetchImpl: fetchImpl as typeof fetch,
    }).respond({
      model: routineModel(),
      instructions: "Devuelve JSON.",
      task: { type: "memory_extract", turn: input },
      usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1 },
      webSearch: false,
      reasoningEffort: "low",
    });
    expect(response.outputText).toBe('{"hechos":[]}');
    if (previous === undefined) delete process.env.XAI_MODEL_ROUTINE;
    else process.env.XAI_MODEL_ROUTINE = previous;
  });
});

describe("aviso de privacidad", () => {
  test("menciona la memoria y el borrado real", () => {
    const page = readFileSync(new URL("../../src/app/(public)/privacidad/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("Memoria del agente");
    expect(page).toContain("Lo que el agente recuerda");
    expect(page).toContain("Ley 19.628");
    expect(page).toContain("Ley 21.719");
    expect(page).toContain("El borrado es real");
  });
});
