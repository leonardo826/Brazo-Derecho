import { describe, expect, test } from "vitest";
import {
  chatInstructions,
  chatSurface,
  isChatAgent,
  marketingContext,
  outputBudget,
  whatsappContext,
} from "@/lib/chat/agents";
import { historyWhere } from "@/lib/chat/history";
import { closeDeliverable, LIMIT_NOTE, replyPace } from "@/lib/chat/pace";

describe("base compartida de los agentes", () => {
  test("marketing y atención usan el mismo motor, con su cupo y sin el computador", () => {
    expect(isChatAgent("QUOTES")).toBe(false);
    expect(chatSurface("MARKETING")).toMatchObject({ metric: "TEXTS", desktop: false, conversationId: "marketing" });
    expect(chatSurface("WHATSAPP")).toMatchObject({ metric: "RESPONSES", desktop: false, conversationId: "whatsapp" });
    expect(chatSurface("ACCOUNTING").desktop).toBe(true);
    expect(chatSurface("MARKETING").suggestions.length).toBeGreaterThan(0);
    expect(chatSurface("WHATSAPP").suggestions.length).toBeGreaterThan(0);
  });

  test("el prompt de marketing queda en borrador y no gasta avisos", () => {
    const prompt = chatInstructions("MARKETING", "Ferretería Los Aromos");
    expect(prompt).toContain("Ferretería Los Aromos");
    expect(prompt).toContain("calendario");
    expect(prompt.toLowerCase()).toContain("borrador");
    expect(prompt).toContain("No publiques");
    expect(prompt).toContain("No gastes presupuesto");
    expect(prompt).toContain("español de Chile");
  });

  test("la atención de prueba usa la ficha y no dice que hay WhatsApp", () => {
    const prompt = chatInstructions("WHATSAPP", "Taller E2E");
    expect(prompt).toContain("prueba en la web");
    expect(prompt).toContain("No hay conexión a WhatsApp");
    const context = whatsappContext({
      name: "Taller E2E",
      rut: "76.123.456-0",
      knowledge: [{ title: "Horario", body: "El sábado abrimos de 9:00 a 14:00." }],
    });
    expect(context).toContain("Taller E2E");
    expect(context).toContain("76.123.456-0");
    expect(context).toContain("El sábado abrimos de 9:00 a 14:00.");
    const brand = marketingContext({
      name: "Ferretería Los Aromos",
      profile: { voice: "cercana", audience: "maestros en Concepción", summary: "tornillos y despacho" },
    });
    expect(brand).toContain("Ferretería Los Aromos");
    expect(brand).toContain("tornillos y despacho");
    expect(brand).toContain("Concepción");
    expect(marketingContext({ name: "Taller", profile: null })).toContain("No hay perfil de marca");
    expect(chatInstructions("MARKETING", "Ferretería Los Aromos")).toContain("gancho");
    expect(chatInstructions("MARKETING", "Ferretería Los Aromos")).toContain("idea de imagen");
    expect(chatSurface("MARKETING").outputTokens).toBeGreaterThan(chatSurface("ACCOUNTING").outputTokens);
    expect(chatSurface("MARKETING").outputRounds).toBeGreaterThan(1);
  });

  test("marketing puede escribir varios posts y, si el tope corta, cierra sin el aviso", () => {
    const pace = outputBudget("MARKETING", replyPace("Propón 3 ideas de post"));
    expect(pace.maxOutputTokens).toBeGreaterThanOrEqual(3200);
    expect(pace.rounds).toBeGreaterThanOrEqual(4);
    expect(outputBudget("ACCOUNTING", replyPace("Resume el IVA en dos frases")).maxOutputTokens).toBe(220);
    const closed = closeDeliverable(`Primer post\n\nSegundo post a medias\n\n${LIMIT_NOTE}`);
    expect(closed).toContain("Primer post");
    expect(closed).not.toContain(LIMIT_NOTE);
    expect(closed).toContain("sigo con lo que falta");
  });

  test("cada agente guarda su propio hilo", () => {
    expect(historyWhere("hilo", "org", "MARKETING").thread.agent).toBe("MARKETING");
    expect(historyWhere("hilo", "org", "WHATSAPP").thread.agent).toBe("WHATSAPP");
    expect(historyWhere("hilo", "org").thread.agent).toBe("ACCOUNTING");
  });
});
