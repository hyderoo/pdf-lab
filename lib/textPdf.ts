"use client";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Structured plain-text -> PDF. Approximates document structure:
// title, ALL-CAPS/short heading lines in bold, bullet lines with hanging
// indent, paragraphs with blank-line gaps. Not pixel-identical to any
// source layout - it typesets the text's own structure.
export async function textToPdf(title: string | null, body: string): Promise<Blob> {
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
    if (line.length === 0 || line.length > 60 || isFirst) return false;
    if (line.endsWith(":")) return true;
    const letters = line.replace(/[^A-Za-z]/g, "");
    return letters.length >= 3 && line === line.toUpperCase();
  };

  // Trailing date range, e.g. "Software Engineer, Shopee   Jun 2026 to Present"
  const DATE_TAIL =
    /^(.*?\S)\s+((?:(?:Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Aug|Sep|Okt|Oct|Nov|Des|Dec)[a-z]*\.?\s+)?\d{4}\s*(?:[-–—]|to|s\.d\.|hingga|sampai)\s*(?:(?:(?:Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Aug|Sep|Okt|Oct|Nov|Des|Dec)[a-z]*\.?\s+)?\d{4}|Present|present|Sekarang|sekarang))$/;

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

  // Optional document title (file-derived); callers may pass null to skip.
  if (title) {
    for (const l of wrap(clean(title), 15, bold, maxW)) {
      ensureSpace(20);
      page.drawText(l, { x: margin, y, size: 15, font: bold, color: dark });
      y -= 20;
    }
    y -= 8;
  }

  const rawLines = clean(body).split("\n");
  let seenContent = false;
  for (const raw of rawLines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      y -= 7; // paragraph gap
      continue;
    }
    if (!seenContent) {
      // First content line: treat as the document's name header.
      seenContent = true;
      for (const l of wrap(t, 16, bold, maxW)) {
        ensureSpace(22);
        page.drawText(l, { x: margin, y, size: 16, font: bold, color: dark });
        y -= 21;
      }
      continue;
    }
    if (isHeading(t, false)) {
      y -= 7; // extra space before headings
      ensureSpace(24);
      for (const l of wrap(t, 12.5, bold, maxW)) {
        page.drawText(l, { x: margin, y, size: 12.5, font: bold, color: dark });
        y -= 15;
      }
      page.drawLine({
        start: { x: margin, y: y + 3 },
        end: { x: margin + maxW, y: y + 3 },
        thickness: 0.6,
        color: rgb(0.8, 0.82, 0.85),
      });
      y -= 6;
      continue;
    }
    const bullet = /^[-*]\s+/.test(t);
    const text = bullet ? t.replace(/^[-*]\s+/, "") : t;
    const indent = bullet ? 14 : 0;
    // Right-align a trailing date range on the same line, like CV layouts.
    const dm = text.match(DATE_TAIL);
    if (dm && font.widthOfTextAtSize(text, 11) <= maxW - indent) {
      ensureSpace(16);
      if (bullet) page.drawText("-", { x: margin, y, size: 11, font: bold, color: ink });
      page.drawText(dm[1], { x: margin + indent, y, size: 11, font, color: ink });
      const w = font.widthOfTextAtSize(dm[2], 11);
      page.drawText(dm[2], { x: pw - margin - w, y, size: 11, font, color: ink });
      y -= 15;
      continue;
    }
    const lines = wrap(text, 11, font, maxW - indent);
    for (let i = 0; i < lines.length; i++) {
      ensureSpace(16);
      if (bullet && i === 0) {
        page.drawText("-", { x: margin, y, size: 11, font: bold, color: ink });
      }
      page.drawText(lines[i], { x: margin + indent, y, size: 11, font, color: ink });
      y -= 15;
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

import type { TextBlock } from "./pdf";

// Re-render translated blocks with the source's visual structure:
// sizes, bold, bullets, right-aligned dates, heading rules, original page
// size. Auto-shrinks (max 2 steps) so a 1-page source stays 1 page.
export async function blocksToPdf(
  blocks: TextBlock[],
  srcPage: { width: number; height: number },
  srcMargin: number
): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pw = srcPage.width;
  const ph = srcPage.height;
  const margin = Math.min(Math.max(srcMargin, 36), 80);
  const maxW = pw - margin * 2;
  const ink = rgb(0.15, 0.17, 0.2);
  const dark = rgb(0.1, 0.12, 0.16);
  const clean = (s: string) => s.replace(/[^\x20-\x7E\xC0-\xFF]/g, " ").replace(/[ \t]+/g, " ");

  const srcPages = Math.max(...blocks.map((b) => b.page), 1);

  const layout = (scale: number): number => {
    let pages = 1;
    let y = ph - margin;
    for (const b of blocks) {
      const size = Math.max(8, b.size * scale);
      const lh = size * 1.35;
      const f = b.bold || b.kind === "name" || b.kind === "heading" ? bold : font;
      const indent = b.kind === "bullet" ? 14 : 0;
      const gapBefore = b.kind === "heading" ? size * 0.7 : 0;
      const lines = wrapInto(clean(b.text), size, f, maxW - indent);
      const need = gapBefore + lines.length * lh + (b.kind === "heading" ? 6 : 0) + size * 0.25;
      if (y - need < margin) {
        pages++;
        y = ph - margin;
      }
      y -= need;
    }
    return pages;
  };

  const wrapInto = (text: string, size: number, f: PDFFont, width: number): string[] => {
    const out: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) > width && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    if (line) out.push(line);
    return out;
  };

  let scale = 1;
  for (const cand of [1, 0.92, 0.85]) {
    scale = cand;
    if (layout(cand) <= srcPages) break;
  }

  let page: PDFPage = doc.addPage([pw, ph]);
  let curSrc = 1;
  let y = ph - margin;
  for (const b of blocks) {
    const size = Math.max(8, b.size * scale);
    const lh = size * 1.35;
    const isHead = b.kind === "name" || b.kind === "heading";
    const f = b.bold || isHead ? bold : font;
    const indent = b.kind === "bullet" ? 14 : 0;
    const gapBefore = b.kind === "heading" ? size * 0.7 : 0;
    while (b.page > curSrc) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
      curSrc++;
    }
    const lines = wrapInto(clean(b.text), size, f, maxW - indent);
    if (y - (gapBefore + lh) < margin) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
    y -= gapBefore;
    for (let i = 0; i < lines.length; i++) {
      if (y < margin + lh) {
        page = doc.addPage([pw, ph]);
        y = ph - margin;
      }
      if (b.kind === "bullet" && i === 0) {
        page.drawText("-", { x: margin, y: y - size, size, font: bold, color: ink });
      }
      page.drawText(lines[i], { x: margin + indent, y: y - size, size, font: f, color: isHead ? dark : ink });
      if (i === 0 && b.date) {
        const d = clean(b.date);
        const w = font.widthOfTextAtSize(d, size);
        page.drawText(d, { x: pw - margin - w, y: y - size, size, font, color: ink });
      }
      y -= lh;
    }
    if (b.kind === "heading") {
      page.drawLine({
        start: { x: margin, y: y + size * 0.35 },
        end: { x: margin + maxW, y: y + size * 0.35 },
        thickness: 0.6,
        color: rgb(0.8, 0.82, 0.85),
      });
      y -= 6;
    }
    y -= size * 0.25;
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
