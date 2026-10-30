function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlBody(paragraphs: string[], url: string) {
  const blocks = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const href = escapeHtml(url);
  return `<!DOCTYPE html><html lang="es"><body>${blocks}<p><a href="${href}">${href}</a></p><p>Brazo Derecho</p></body></html>`;
}

export function verificationEmail(input: { name: string; url: string }) {
  const subject = "Confirma tu correo en Brazo Derecho";
  const paragraphs = [
    `Hola ${input.name},`,
    "Confirma tu correo para dejar lista la cuenta. Puedes usar el panel antes de abrir este enlace.",
    "El enlace dura 48 horas y se puede usar una sola vez.",
    "Si no creaste esta cuenta, ignora este mensaje.",
    "Abre este enlace:",
  ];
  return {
    subject,
    text: [...paragraphs, input.url, "", "Brazo Derecho"].join("\n"),
    html: htmlBody(paragraphs, input.url),
  };
}

export function passwordResetEmail(input: { name: string; url: string }) {
  const subject = "Recupera tu clave de Brazo Derecho";
  const paragraphs = [
    `Hola ${input.name},`,
    "Recibimos un pedido para cambiar la contraseña de tu cuenta.",
    "El enlace dura 1 hora y se puede usar una sola vez. Si no fuiste tú, ignora este mensaje: la contraseña no cambia.",
    "Abre este enlace:",
  ];
  return {
    subject,
    text: [...paragraphs, input.url, "", "Brazo Derecho"].join("\n"),
    html: htmlBody(paragraphs, input.url),
  };
}
