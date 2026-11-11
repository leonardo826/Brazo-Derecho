export function hideActionMarker(text: string) {
  const marker = text.search(/ACCION_SENSIBLE\s*:/i);
  if (marker < 0) return text;
  return text.slice(0, marker).replace(/[ \t]+$/, "");
}

export function plainSpeech(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}
