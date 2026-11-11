import { randomFillSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { attachmentHeaders, chatPreview } from "@/lib/chat/image-preview";
import sharp from "sharp";

describe("vista de la imagen", () => {
  test("la vista lleva largo y caché, y una imagen grande baja de 500 KB", async () => {
    const headers = attachmentHeaders({ mimeType: "image/jpeg", fileName: "publicidad.png", size: 1200, download: false });
    expect(headers["Content-Length"]).toBe("1200");
    expect(headers["Cache-Control"]).toContain("max-age=86400");
    expect(headers["Content-Disposition"]).toContain("inline");
    const download = attachmentHeaders({ mimeType: "image/png", fileName: "publicidad.png", size: 9, download: true });
    expect(download["Content-Disposition"]).toContain("attachment");
    const raw = Buffer.alloc(720 * 720 * 3);
    randomFillSync(raw);
    const big = await sharp(raw, { raw: { width: 720, height: 720, channels: 3 } }).png().toBuffer();
    expect(big.byteLength).toBeGreaterThan(500_000);
    const preview = await chatPreview(new Uint8Array(big), "image/png");
    expect(preview.mimeType).toBe("image/jpeg");
    expect(preview.bytes.byteLength).toBeLessThan(500_000);
    expect(preview.bytes[0]).toBe(0xff);
  });
});