import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentMemoryPanel } from "@/components/agent-memory";
import { memoryPanelVisible } from "@/lib/memory/policy";

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

  test("apagada, igual se puede borrar lo que quedó", () => {
    expect(memoryPanelVisible(false, 0)).toBe(false);
    expect(memoryPanelVisible(false, 1)).toBe(true);
    const html = renderToStaticMarkup(
      createElement(AgentMemoryPanel, {
        agent: "MARKETING",
        expanded: true,
        enabled: false,
        facts: [
          {
            id: "fact-9",
            text: "El rubro es cafetería.",
            scope: "empresa",
            createdAt: new Date("2026-11-26T15:00:00Z"),
          },
        ],
      }),
    );
    expect(html).toContain("La memoria está apagada");
    expect(html).toContain("Borrar: El rubro es cafetería.");
    expect(html).toContain("Borrar todo");
  });
});
