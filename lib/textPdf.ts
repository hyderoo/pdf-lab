"use client";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Structured plain-text -> PDF. Approximates document structure:
// title, ALL-CAPS/short heading lines in bold, bullet lines with hanging
// indent, paragraphs with blank-line gaps. Not pixel-identical to any
// source layout - it typesets the text's own structure.
export async function textToPdf(title: string, body: string): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pw = 595.28;
  const ph = 841.89;
  const margin = 56;
  const maxW = pw - margin * 2;

  // Normalize to WinAnsi-safe text (pdf-lib Helvetica).
  const clean = (s: string) =>
    s.replace(/[^\x20-\x7E\xC0-\xFF\n]/g, " ").replace(/[ \t]+/g, " ");

  const isHeading = (line: string, isFirst: boolean): boolean => {
    if (line.length === 0 || line.length > 60) return false;
    if (isFirst) return true;
    if (line.endsWith(":")) return true;
    const letters = line.replace(/[^A-Za-z]/g, "");
    return letters.length >= 3 && line === line.toUpperCase();
  };

  const wrap = (
    text: string,
    size: number,
    f: PDFFont,
    width: number
  ): string[] => {
    const out: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) > width && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    return out;
  };

  let page: PDFPage = doc.addPage([pw, ph]);
  let y = ph - margin;
  const ensureSpace = (need: number) => {
    if (y < margin + need) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
  };
  const ink = rgb(0.15, 0.17, 0.2);
  const dark = rgb(0.1, 0.12, 0.16);

  // Document title (file-derived)
  for (const l of wrap(clean(title), 15, bold, maxW)) {
    ensureSpace(20);
    page.drawText(l, { x: margin, y, size: 15, font: bold, color: dark });
    y -= 20;
  }
  y -= 8;

  const rawLines = clean(body).split("\n");
  let seenContent = false;
  for (const raw of rawLines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      y -= 8; // paragraph gap
      continue;
    }
    const heading = isHeading(t, !seenContent);
    seenContent = true;
    if (heading) {
      y -= 6; // extra space before headings
      ensureSpace(20);
      for (const l of wrap(t, 12.5, bold, maxW)) {
        page.drawText(l, { x: margin, y, size: 12.5, font: bold, color: dark });
        y -= 17;
      }
      continue;
    }
    const bullet = /^[-*]\s+/.test(t);
    const text = bullet ? t.replace(/^[-*]\s+/, "") : t;
    const indent = bullet ? 14 : 0;
    const lines = wrap(text, 11, font, maxW - indent);
    for (let i = 0; i < lines.length; i++) {
      ensureSpace(16);
      if (bullet && i === 0) {
        page.drawText("-", { x: margin, y, size: 11, font: bold, color: ink });
      }
      page.drawText(lines[i], { x: margin + indent, y, size: 11, font, color: ink });
      y -= 16;
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
