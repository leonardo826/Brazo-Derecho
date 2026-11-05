export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 4;
export const MAX_IMAGE_MODEL_BYTES = 1_500_000;

export type PreparedFile = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

function hasNull(bytes: Uint8Array) {
  return bytes.includes(0);
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

export function safeFileName(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "archivo";
  const clean = base.replace(/[^\w.\- ()áéíóúüñÁÉÍÓÚÜÑ]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return clean || "archivo";
}

function extension(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

export function prepareUpload(name: string, bytes: Uint8Array): PreparedFile | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return null;
  const fileName = safeFileName(name);
  const ext = extension(fileName);
  if ((ext === "jpg" || ext === "jpeg") && startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { fileName, mimeType: "image/jpeg", bytes };
  }
  if (ext === "png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return { fileName, mimeType: "image/png", bytes };
  }
  if (ext === "gif" && startsWith(bytes, [0x47, 0x49, 0x46])) {
    return { fileName, mimeType: "image/gif", bytes };
  }
  if (ext === "webp" && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return { fileName, mimeType: "image/webp", bytes };
  }
  if (ext === "pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { fileName, mimeType: "application/pdf", bytes };
  }
  if ((ext === "txt" || ext === "csv" || ext === "json") && !hasNull(bytes)) {
    const mimeType = ext === "csv" ? "text/csv" : ext === "json" ? "application/json" : "text/plain";
    return { fileName, mimeType, bytes };
  }
  return null;
}

export function textExcerpt(file: PreparedFile) {
  if (file.mimeType.startsWith("text/") || file.mimeType === "application/json") {
    return new TextDecoder("utf-8", { fatal: false }).decode(file.bytes).slice(0, 6000);
  }
  return "";
}

export function imageDataUrl(file: PreparedFile) {
  if (!file.mimeType.startsWith("image/") || file.bytes.byteLength > MAX_IMAGE_MODEL_BYTES) return "";
  const base64 = Buffer.from(file.bytes).toString("base64");
  return `data:${file.mimeType};base64,${base64}`;
}

export function attachmentScope(organizationId: string, id: string) {
  return {
    id,
    organizationId,
    message: { thread: { organizationId } },
  };
}
