export function hideActionMarker(text: string) {
  const marker = text.search(/ACCION_SENSIBLE\s*:/i);
  return (marker >= 0 ? text.slice(0, marker) : text).trim();
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
