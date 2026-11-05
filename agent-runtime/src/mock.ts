import { parseHttpUrl } from "./actions.ts";
import type { ComputerModel } from "./desktop.ts";

export function mockUrlForGoal(goal: string) {
  const explicit = goal.match(/https?:\/\/[^\s"'<>]+/);
  if (explicit) {
    const url = parseHttpUrl(explicit[0].replace(/[).,]+$/g, ""));
    if (url) return url;
  }
  if (/wikipedia/i.test(goal)) {
    const quoted = goal.match(/[«"]([^»"]+)[»"]/);
    let query = quoted?.[1] ?? "";
    if (!query) {
      const match = goal.match(/busca(?:r)?\s+(.+?)(?:\s+en\s+wikipedia|$)/i);
      query = match?.[1] ?? "Chile";
    }
    query = query.replace(/en wikipedia/gi, "").trim() || "Chile";
    return `https://es.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
  }
  return "https://example.com/";
}

export function createMockModel(): ComputerModel {
  let acted = false;
  let url = "https://example.com/";
  return {
    async decide(ctx) {
      if (!ctx.screenshot.length) throw new Error("sin_captura");
      if (!acted) {
        acted = true;
        url = mockUrlForGoal(ctx.goal);
        return { kind: "act", action: { type: "goto", url } };
      }
      return {
        kind: "done",
        result: `Simulador: abrí ${url} y tomé una captura (${ctx.screenshot.length} bytes). No llamé a xAI.`,
      };
    },
  };
}
