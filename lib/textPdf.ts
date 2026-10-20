"use client";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

  const wrap = (text: string, size: number, f: typeof font): string[] => {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      if (!para.trim()) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) > maxW && line) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
    }
    return out;
  };

  let page = doc.addPage([pw, ph]);
  let y = ph - margin;

  const titleLines = wrap(clean(title), 16, bold);
  for (const l of titleLines) {
    page.drawText(l, { x: margin, y, size: 16, font: bold, color: rgb(0.1, 0.12, 0.16) });
    y -= 22;
  }
  y -= 10;

  const lines = wrap(clean(body), 11, font);
  for (const l of lines) {
    if (y < margin + 16) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
    if (l) page.drawText(l, { x: margin, y, size: 11, font, color: rgb(0.15, 0.17, 0.2) });
    y -= 16;
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
