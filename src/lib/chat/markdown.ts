export type MdInline =
  | { type: "text"; text: string }
  | { type: "break" }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string };

export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: MdInline[] }
  | { type: "list"; ordered: boolean; items: MdInline[][] }
  | { type: "code"; text: string };

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;

/** El modelo a veces cita como `[[1]](url)`. El parser ya entiende `[1](url)`. */
const CITATION = /\[\[([^\]\n]+)\]\]\(([^)\s]+)\)/g;

export function normalizeCitations(source: string) {
  return source.replace(CITATION, "[$1]($2)");
}

const APP_PATH = /^\/panel\/[a-z0-9]+(?:\/[a-z0-9-]+)*$/;
const VAULT_FORM = /^\/panel\/boveda(?:\?portal=(?:sii|previred|tesoreria))?(?:#agregar-acceso)?$/;

export function safeHref(raw: string) {
  if (APP_PATH.test(raw) || VAULT_FORM.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    return "";
  }
  return "";
}

export function parseInline(input: string): MdInline[] {
  const nodes: MdInline[] = [];
  let last = 0;
  for (const match of input.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: "text", text: input.slice(last, index) });
    const token = match[0];
    if (token.startsWith("`")) nodes.push({ type: "code", text: token.slice(1, -1) });
    else if (token.startsWith("**")) nodes.push({ type: "strong", text: token.slice(2, -2) });
    else if (token.startsWith("*")) nodes.push({ type: "em", text: token.slice(1, -1) });
    else {
      const href = safeHref(match[6] ?? "");
      if (href) nodes.push({ type: "link", href, text: match[5] ?? "" });
      else nodes.push({ type: "text", text: match[5] || token });
    }
    last = index + token.length;
  }
  if (last < input.length) nodes.push({ type: "text", text: input.slice(last) });
  return nodes;
}

function splitListLine(line: string) {
  const lead = line.replace(/([.!?…:])[ \t]*[-–—•][ \t]+(?=\S)/g, "$1\n- ");
  return lead
    .split("\n")
    .map((part) => {
      const marks = part.match(/(?:^|\s)[-–—•]\s+\S/g);
      if (!marks || marks.length < 2) return part;
      return part.replace(/\s+[-–—•]\s+/g, "\n- ");
    })
    .join("\n");
}

/** Separa « - » que sigue a una frase, y también varios ítems en la misma línea. */
export function normalizeLists(source: string) {
  let fence = false;
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fence = !fence;
        return line;
      }
      if (fence) return line;
      return splitListLine(line);
    })
    .join("\n");
}

const SECTION = /[ \t]+((?:Gancho|Cuerpo|Llamado a la acci[oó]n|Hashtags|Idea de imagen)\s*:)/gi;

export function normalizeSections(source: string) {
  return source.replace(SECTION, "\n\n$1");
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function citationKind(label: string, url: string) {
  const host = hostOf(url);
  if (!host) return "";
  const clean = label.trim().toLowerCase().replace(/^www\./, "");
  if (/^\d{1,3}$/.test(clean)) return "number";
  if (clean === host) return "host";
  if (clean === host.split(".")[0]) return "brand";
  return "";
}

/** Un enlace suelto con la marca o el dominio pasa a «(fuente)». */
export function softenCitationLinks(source: string) {
  return source.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (full, label: string, url: string, offset: number, all: string) => {
    const kind = citationKind(label, url);
    if (!kind) return full;
    const before = all.slice(Math.max(0, offset - 3), offset);
    if (kind === "brand" && !/[.!?]\s*$/.test(before)) return full;
    return `[(fuente)](${url})`;
  });
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = normalizeSections(normalizeLists(softenCitationLinks(normalizeCitations(source)))).replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().startsWith("```")) {
      const collected: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        collected.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: collected.join("\n") });
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline(heading[2]) });
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push(parseInline((lines[index] ?? "").replace(/^\s*[-*]\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push(parseInline((lines[index] ?? "").replace(/^\s*\d+\.\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !/^(#{1,3}\s|```|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    const children: MdInline[] = [];
    paragraph.forEach((part, partIndex) => {
      if (partIndex > 0) children.push({ type: "break" });
      children.push(...parseInline(part));
    });
    blocks.push({ type: "paragraph", children });
  }
  return blocks;
}
