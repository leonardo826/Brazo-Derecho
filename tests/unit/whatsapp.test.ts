import { describe, expect, test } from "vitest";
import { decideWhatsappReply, type Knowledge } from "@/lib/agents/whatsapp";
import { renderMockTask } from "@/lib/xai/mock";

const knowledge: Knowledge[] = [
  {
    id: "1",
    title: "Horario de atención",
    body: "Abrimos de lunes a viernes de 9:00 a 19:00 y los sábados de 9:00 a 14:00.",
  },
  {
    id: "2",
    title: "Medios de pago",
    body: "En tienda aceptamos efectivo, débito y crédito. Este chat no recibe pagos.",
  },
];

describe("atención WhatsApp", () => {
  test("responde el horario con la ficha, sin inventar", () => {
    const decision = decideWhatsappReply("¿A qué hora abren el sábado?", knowledge);
    expect(decision.kind).toBe("answer");
    if (decision.kind !== "answer") return;
    const text = renderMockTask({ type: "whatsapp_answer", title: decision.item.title, body: decision.item.body });
    expect(text).toContain(decision.item.body);
    expect(text).not.toMatch(/descuento/i);
  });

  test("un saludo sin datos se deriva a una persona", () => {
    expect(decideWhatsappReply("hola", knowledge).kind).toBe("escalate");
    expect(renderMockTask({ type: "whatsapp_escalate" })).toMatch(/persona del equipo/);
  });

  test("el descuento se rechaza aunque el mensaje también pregunte el horario", () => {
    const decision = decideWhatsappReply("¿Me haces un descuento? ¿A qué hora abren?", knowledge);
    expect(decision.kind).toBe("refuse");
    if (decision.kind !== "refuse") return;
    expect(decision.code).toBe("discount");
    expect(renderMockTask({ type: "whatsapp_refuse", reply: decision.reply })).toBe(decision.reply);
  });

  test("preguntar por débito no es un cobro y usa la ficha de pagos", () => {
    const decision = decideWhatsappReply("¿Aceptan débito?", knowledge);
    expect(decision.kind).toBe("answer");
    if (decision.kind === "answer") expect(decision.item.title).toMatch(/pago/i);
  });

  test("no cobra, no asesora y no manda publicidad", () => {
    expect(decideWhatsappReply("Pásame un link de pago", knowledge).kind).toBe("refuse");
    expect(decideWhatsappReply("¿Me pueden demandar por esto?", knowledge).kind).toBe("refuse");
    expect(decideWhatsappReply("¿Qué pastilla sirve para el dolor?", knowledge).kind).toBe("refuse");
    expect(decideWhatsappReply("Mándale publicidad masiva a todos los contactos", knowledge).kind).toBe("refuse");
  });
});
