import { safeFileName } from "@/lib/chat/files";

const PREVIEW_LIMIT = 500_000;

export function attachmentHeaders(input: { mimeType: string; fileName: string; size: number; download: boolean }) {
  const name = safeFileName(input.fileName);
  return {
    "Content-Type": input.mimeType,
    "Content-Length": String(input.size),
    "Content-Disposition": `${input.download ? "attachment" : "inline"}; filename="${name}"`,
    "Cache-Control": input.download ? "private, max-age=3600" : "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
}

/** La vista del chat baja de 500 KB. La descarga sigue con el archivo original. */
export async function chatPreview(bytes: Uint8Array, mimeType: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!mimeType.startsWith("image/") || bytes.byteLength <= PREVIEW_LIMIT) return { bytes, mimeType };
  try {
    const sharp = (await import("sharp")).default;
    let width = 1280;
    let quality = 72;
    let out = await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
    while (out.byteLength > PREVIEW_LIMIT && quality > 36) {
      quality -= 8;
      width = Math.max(720, width - 160);
      out = await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
    }
    if (out.byteLength >= bytes.byteLength) return { bytes, mimeType };
    return { bytes: new Uint8Array(out), mimeType: "image/jpeg" };
  } catch {
    return { bytes, mimeType };
  }
}
