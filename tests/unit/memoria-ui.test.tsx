import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentMemory, AgentMemoryPanel } from "@/components/agent-memory";

describe("panel de memoria", () => {
  test("lista los datos y ofrece borrar uno y borrar todo", () => {
    const html = renderToStaticMarkup(
      createElement(AgentMemoryPanel, {
        agent: "ACCOUNTING",
        expanded: true,
        facts: [
          {
            id: "fact-1",
            text: "El RUT de la empresa es 76.123.456-0.",
            scope: "empresa",
            createdAt: new Date("2026-11-26T15:00:00Z"),
          },
          {
            id: "fact-2",
            text: "El tono que prefieren es cercano.",
            scope: "agente",
            createdAt: new Date("2026-11-26T15:05:00Z"),
          },
        ],
      }),
    );
    expect(html).toContain("Lo que el agente recuerda");
    expect(html).toContain("El RUT de la empresa es 76.123.456-0.");
    expect(html).toContain("De la empresa");
    expect(html).toContain("De este agente");
    expect(html).toContain("Borrar todo");
    expect(html).toContain("Borrar: El tono que prefieren es cercano.");
    expect(html).toContain("Ley 19.628");
    expect(html).toContain('name="agente" value="ACCOUNTING"');
  });

  test("sin datos avisa que todavía no hay nada guardado", () => {
    const html = renderToStaticMarkup(
      createElement(AgentMemoryPanel, { agent: "WHATSAPP", expanded: true, facts: [] }),
    );
    expect(html).toContain("Todavía no hay datos guardados");
    expect(html).not.toContain("Borrar todo");
  });

  test("apagada, la sección no se muestra", async () => {
    const previous = process.env.MEMORY_FEATURE_ENABLED;
    delete process.env.MEMORY_FEATURE_ENABLED;
    try {
      expect(await AgentMemory({ organizationId: "org-a", agent: "MARKETING" })).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.MEMORY_FEATURE_ENABLED;
      else process.env.MEMORY_FEATURE_ENABLED = previous;
    }
  });
});
