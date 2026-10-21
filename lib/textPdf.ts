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

import type { ExtractedDoc, TextBlock } from "./pdf";

// Re-render translated blocks with the source's visual structure: sizes,
// bold runs, bullets, right-aligned dates, centered header lines, heading
// rules, original page size and margins. Auto-shrinks so a 1-page source
// stays 1 page.
export async function blocksToPdf(
  blocks: TextBlock[],
  layout: ExtractedDoc["layout"]
): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pw = layout.pageWidth;
  const ph = layout.pageHeight;
  const mL = Math.min(Math.max(layout.marginLeft, 20), 90);
  const mR = Math.min(Math.max(layout.marginRight, 20), 90);
  const maxW = pw - mL - mR;
  const ink = rgb(0.15, 0.17, 0.2);
  const dark = rgb(0.1, 0.12, 0.16);
  // Keep everything WinAnsi (pdf-lib standard fonts) can encode, including
  // en/em dashes, curly quotes, bullet and ellipsis.
  const clean = (s: string) =>
    s
      .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u2122]/g, " ")
      .replace(/[ \t]+/g, " ");

  type Tok = { w: string; b: boolean };
  const tokensOf = (b: TextBlock): Tok[] => {
    const segs =
      b.segments && b.segments.length
        ? b.segments
        : [{ t: b.text, b: b.bold || b.kind === "name" || b.kind === "heading" }];
    const out: Tok[] = [];
    for (const s of segs) {
      for (const w of clean(s.t).split(" ")) {
        if (w) out.push({ w, b: s.b });
      }
    }
    return out;
  };
  const tokWidth = (t: Tok, size: number) =>
    (t.b ? bold : font).widthOfTextAtSize(t.w, size);
  const spaceW = (size: number) => font.widthOfTextAtSize(" ", size);

  // Greedy wrap of bold-tagged tokens into lines.
  const wrapToks = (toks: Tok[], size: number, width: number): Tok[][] => {
    const lines: Tok[][] = [];
    let cur: Tok[] = [];
    let curW = 0;
    for (const t of toks) {
      const tw = tokWidth(t, size);
      const add = cur.length ? curW + spaceW(size) + tw : tw;
      if (cur.length && add > width) {
        lines.push(cur);
        cur = [t];
        curW = tw;
      } else {
        cur.push(t);
        curW = add;
      }
    }
    if (cur.length) lines.push(cur);
    return lines;
  };

  const lineWidth = (toks: Tok[], size: number) =>
    toks.reduce((acc, t, i) => acc + tokWidth(t, size) + (i ? spaceW(size) : 0), 0);

  const srcPages = Math.max(layout.pageCount, 1);
  const topY = Math.min(Math.max(layout.startY, ph - 120), ph - 20);
  const bottomY = Math.min(Math.max(mR, 24), 60);

  const blockHeight = (b: TextBlock, scale: number): number => {
    const size = b.size * scale;
    const lh = size * 1.32;
    const indent = b.kind === "bullet" ? 10 * scale : 0;
    const lines = wrapToks(tokensOf(b), size, maxW - indent).length;
    const gapBefore = b.kind === "heading" ? size * 0.8 : b.kind === "name" ? 0 : size * 0.12;
    const after = b.kind === "heading" ? size * 0.55 : size * 0.12;
    return gapBefore + lines * lh + after;
  };

  const totalPages = (scale: number): number => {
    let pages = 1;
    let y = topY;
    let curSrc = 1;
    for (const b of blocks) {
      if (b.page > curSrc) {
        pages += b.page - curSrc;
        curSrc = b.page;
        y = topY;
      }
      const h = blockHeight(b, scale);
      if (y - h < bottomY) {
        pages++;
        y = topY;
      }
      y -= h;
    }
    return pages;
  };

  let scale = 1;
  for (const cand of [1, 0.95, 0.9, 0.85, 0.8]) {
    scale = cand;
    if (totalPages(cand) <= srcPages) break;
  }

  let page: PDFPage = doc.addPage([pw, ph]);
  let curSrc = 1;
  let y = topY;
  const newPage = () => {
    page = doc.addPage([pw, ph]);
    y = topY;
  };

  for (const b of blocks) {
    const size = b.size * scale;
    const lh = size * 1.32;
    const indent = b.kind === "bullet" ? 10 * scale : 0;
    while (b.page > curSrc) {
      newPage();
      curSrc++;
    }
    const gapBefore = b.kind === "heading" ? size * 0.8 : b.kind === "name" ? 0 : size * 0.12;
    if (y - gapBefore - lh < bottomY) newPage();
    y -= gapBefore;

    const lines = wrapToks(tokensOf(b), size, maxW - indent - (b.date ? 90 * scale : 0));
    for (let i = 0; i < lines.length; i++) {
      if (y - lh < bottomY) newPage();
      const toks = lines[i];
      const lw = lineWidth(toks, size);
      let x = mL + indent;
      if (b.align === "center") x = mL + Math.max(0, (maxW - lw) / 2);
      const baseline = y - size;
      if (b.kind === "bullet" && i === 0) {
        page.drawText("\u2022", { x: mL, y: baseline, size, font: bold, color: ink });
      }
      for (let ti = 0; ti < toks.length; ti++) {
        const t = toks[ti];
        const f = t.b ? bold : font;
        page.drawText(t.w, { x, y: baseline, size, font: f, color: b.kind === "name" || b.kind === "heading" ? dark : ink });
        x += tokWidth(t, size) + spaceW(size);
      }
      if (i === 0 && b.date) {
        const d = clean(b.date);
        const df = b.dateBold ? bold : font;
        const w = df.widthOfTextAtSize(d, size);
        page.drawText(d, { x: pw - mR - w, y: baseline, size, font: df, color: ink });
      }
      y -= lh;
    }
    if (b.kind === "heading") {
      page.drawLine({
        start: { x: mL, y: y + size * 0.32 },
        end: { x: pw - mR, y: y + size * 0.32 },
        thickness: 0.6,
        color: rgb(0.8, 0.82, 0.85),
      });
      y -= size * 0.55;
    } else {
      y -= size * 0.12;
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
