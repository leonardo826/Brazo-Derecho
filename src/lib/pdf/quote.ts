import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatClp, formatDay, quoteCode } from "@/lib/format";

export type PdfQuote = {
  number: number;
  customerName: string;
  notes: string;
  unmatchedNote: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  totalClp: number;
  createdAt: Date;
  organization: { name: string; rut: string | null };
  lines: { description: string; unit: string; quantity: number; unitPriceClp: number }[];
};

const STATUS_LABEL = {
  DRAFT: "Borrador",
  PENDING_APPROVAL: "Pendiente de aprobación",
  APPROVED: "Aprobada por la empresa",
  REJECTED: "Rechazada",
};

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export async function renderQuotePdf(quote: PdfQuote) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  let y = 800;

  const draw = (text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const size = options.size ?? 11;
    const used = options.font ?? font;
    const lines = wrap(text, used, size, 500);
    for (const line of lines) {
      if (y < 70) {
        page = doc.addPage([595.28, 841.89]);
        y = 800;
      }
      page.drawText(line, { x: 48, y, size, font: used, color: options.color ?? rgb(0.11, 0.1, 0.08) });
      y -= size + 5;
    }
  };

  page.drawRectangle({ x: 0, y: 790, width: 595.28, height: 52, color: rgb(0.08, 0.2, 0.18) });
  page.drawText("Brazo Derecho  ·  Cotización", {
    x: 48,
    y: 810,
    size: 16,
    font: bold,
    color: rgb(0.95, 0.94, 0.9),
  });
  y = 760;
  draw(quote.organization.name, { size: 18, font: bold });
  if (quote.organization.rut) draw(`RUT ${quote.organization.rut}`);
  draw(`${quoteCode(quote.number)}  ·  ${formatDay(quote.createdAt)}`);
  draw(`Cliente: ${quote.customerName}`);
  draw(`Estado: ${STATUS_LABEL[quote.status]}`);
  y -= 8;
  draw("Detalle", { font: bold, size: 13 });
  for (const line of quote.lines) {
    const lineTotal = line.quantity * line.unitPriceClp;
    draw(
      `${line.quantity} ${line.unit}  ·  ${line.description}  ·  ${formatClp(line.unitPriceClp)} c/u  ·  ${formatClp(lineTotal)}`,
    );
  }
  y -= 6;
  draw(`Total ${formatClp(quote.totalClp)}`, { font: bold, size: 14 });
  if (quote.notes) {
    y -= 6;
    draw(`Notas: ${quote.notes}`);
  }
  if (quote.unmatchedNote) {
    y -= 4;
    draw(quote.unmatchedNote);
  }
  y -= 12;
  draw(
    "Los precios salen de la lista de la empresa. Brazo Derecho no envía esta cotización ni emite boleta o factura. El envío al cliente lo hace una persona.",
    { size: 9, color: rgb(0.35, 0.32, 0.28) },
  );

  const pages = doc.getPages();
  pages.forEach((current: PDFPage, index) => {
    current.drawText(`Página ${index + 1} de ${pages.length}`, {
      x: 48,
      y: 36,
      size: 9,
      font,
      color: rgb(0.4, 0.37, 0.32),
    });
  });

  return doc.save();
}
