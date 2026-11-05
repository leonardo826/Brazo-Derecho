export function redactText(text: string, secrets: string[]) {
  const unique = [...new Set(secrets.filter((item) => item.length >= 4))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of unique) {
    out = out.split(secret).join("[redactado]");
  }
  return out;
}
