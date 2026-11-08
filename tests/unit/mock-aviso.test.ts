import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ACCOUNTING_DISCLAIMER } from "@/lib/catalog";
import { vaultFormMessage } from "@/lib/credentials/portal-form";
import { renderMockTask } from "@/lib/xai/mock";

describe("el aviso legal no se repite y el simulador no finge una fuente", () => {
  test("la respuesta de prueba es un ejemplo y no declara normativa verificada", () => {
    const chat = renderMockTask({
      type: "agent_chat",
      today: "8 de noviembre de 2026",
      messages: [{ role: "user", text: "Resume el IVA en dos frases" }],
    });
    const question = renderMockTask({
      type: "accounting_question",
      today: "8 de noviembre de 2026",
      question: "Resume el IVA en dos frases",
    });
    for (const body of [chat, question]) {
      expect(body).toContain("Ejemplo simulado");
      expect(body).toContain("Respuesta de prueba");
      expect(body).not.toMatch(/normativa verificada/i);
      expect(body).not.toContain(ACCOUNTING_DISCLAIMER);
      expect(body).not.toMatch(/conclusi[oó]n/i);
    }
  });

  test("el formulario y la burbuja no agregan el aviso que ya está en el encabezado", () => {
    const form = vaultFormMessage("sii", "Guarda mi root para el SII");
    expect(form).toContain("/panel/boveda?portal=sii#agregar-acceso");
    expect(form).not.toContain(ACCOUNTING_DISCLAIMER);
    const chat = readFileSync("src/components/agent-chat.tsx", "utf8");
    const page = readFileSync("src/app/panel/contador/page.tsx", "utf8");
    expect(chat).not.toContain("ACCOUNTING_DISCLAIMER");
    expect(page.match(/ACCOUNTING_DISCLAIMER/g)).toEqual(["ACCOUNTING_DISCLAIMER", "ACCOUNTING_DISCLAIMER"]);
  });
});
