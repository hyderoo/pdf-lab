"use client";

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

// Annotations are stored in the page's displayed pixel space (scale S);
// divide by S and flip Y when baking into the PDF.
export type Annotation =
  | { id: string; type: "text"; page: number; x: number; y: number; text: string; size: number; color: string; bold: boolean }
  | { id: string; type: "highlight" | "whiteout" | "rect"; page: number; x: number; y: number; w: number; h: number; color: string; thickness: number }
  | { id: string; type: "ellipse"; page: number; x: number; y: number; w: number; h: number; color: string; thickness: number }
  | { id: string; type: "line" | "arrow"; page: number; x1: number; y1: number; x2: number; y2: number; color: string; thickness: number }
  | { id: string; type: "pen"; page: number; points: number[]; color: string; thickness: number }
  | { id: string; type: "image"; page: number; x: number; y: number; w: number; h: number; dataUrl: string }
  // Replaces one existing source line: whites out the original region and
  // draws the new text at the same position/size/weight. baseY is the
  // original baseline (CSS pixel space of the editor canvas).
  | { id: string; type: "edit"; page: number; x: number; baseY: number; w: number; size: number; bold: boolean; color: string; text: string; rightX?: number };

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0;
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

// Greedy word wrap with a caller-supplied width measurer, so the overlay
// (canvas metrics) and the exporter (pdf-lib metrics) wrap identically
// enough for the same text and width.
export function wrapToWidth(text: string, maxW: number, measure: (word: string) => number, spaceW: number): string[] {
  const out: string[] = [];
  let line = "";
  let lineW = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const ww = measure(word);
    const add = line ? lineW + spaceW + ww : ww;
    if (line && add > maxW) {
      out.push(line);
      line = word;
      lineW = ww;
    } else {
      line = line ? line + " " + word : word;
      lineW = add;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

function svgPathFromPoints(points: number[], scale: number, pageHeight: number): string {
  const px = (x: number) => x / scale;
  const py = (y: number) => pageHeight - y / scale;
  let d = `M ${px(points[0])} ${py(points[1])}`;
  for (let i = 2; i < points.length - 1; i += 2) {
    d += ` L ${px(points[i])} ${py(points[i + 1])}`;
  }
  return d;
}

// Bake annotations onto the original PDF bytes. Note: this draws ON TOP of
// the original page content - existing text cannot be edited in place.
export async function exportPdfWithAnnotations(
  srcBytes: ArrayBuffer,
  annotations: Annotation[],
  pageScales: Record<number, number>
): Promise<Blob> {
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const a of annotations) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const S = pageScales[a.page] ?? 1;
    const ph = page.getHeight();
    const X = (x: number) => x / S;
    const Y = (y: number) => ph - y / S;
    const c = hexToRgb("color" in a ? a.color : "#000000");
    const col = rgb(c.r, c.g, c.b);

    switch (a.type) {
      case "text": {
        const f = a.bold ? helvBold : helv;
        const size = a.size / S;
        // pdf-lib standard fonts encode WinAnsi only; drop what it cannot draw.
        const safe = (t: string) =>
          t.replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, " ");
        const lines = safe(a.text).split("\n");
        lines.forEach((line, i) => {
          page.drawText(line, { x: X(a.x), y: Y(a.y) - size * (i + 0.85), size, font: f, color: col });
        });
        break;
      }
      case "highlight":
        page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w / S, height: a.h / S, color: col, opacity: 0.35 });
        break;
      case "whiteout":
        page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w / S, height: a.h / S, color: rgb(1, 1, 1) });
        break;
      case "rect":
        page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w / S, height: a.h / S, borderColor: col, borderWidth: a.thickness / S });
        break;
      case "ellipse":
        page.drawEllipse({ x: X(a.x + a.w / 2), y: Y(a.y + a.h / 2), xScale: a.w / 2 / S, yScale: a.h / 2 / S, borderColor: col, borderWidth: a.thickness / S });
        break;
      case "line":
        page.drawLine({ start: { x: X(a.x1), y: Y(a.y1) }, end: { x: X(a.x2), y: Y(a.y2) }, color: col, thickness: a.thickness / S });
        break;
      case "arrow": {
        page.drawLine({ start: { x: X(a.x1), y: Y(a.y1) }, end: { x: X(a.x2), y: Y(a.y2) }, color: col, thickness: a.thickness / S });
        const ang = Math.atan2(Y(a.y2) - Y(a.y1), X(a.x2) - X(a.x1));
        const len = 10 / S;
        for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
          page.drawLine({
            start: { x: X(a.x2), y: Y(a.y2) },
            end: { x: X(a.x2) + len * Math.cos(ang + da), y: Y(a.y2) + len * Math.sin(ang + da) },
            color: col,
            thickness: a.thickness / S,
          });
        }
        break;
      }
      case "pen": {
        const d = svgPathFromPoints(a.points, S, ph);
        page.drawSvgPath(d, { borderColor: col, borderWidth: a.thickness / S });
        break;
      }
      case "edit": {
        // Whiteout the original line region, then draw the replacement
        // text at the same baseline, size and weight (Helvetica fallback).
        const f = a.bold ? helvBold : helv;
        const size = a.size / S;
        const safe = a.text.replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, " ");
        const whiteTop = a.baseY - a.size * 1.08;
        const whiteH = a.size * 1.38;
        if (a.rightX != null) {
          // Right-aligned piece (e.g. a date column): keep the right edge
          // fixed on one line, growing or shrinking to the left instead of
          // wrapping onto the row below.
          const wNew = f.widthOfTextAtSize(safe, size);
          const x0 = a.rightX / S - wNew;
          const xMin = Math.min(x0, X(a.x));
          page.drawRectangle({
            x: xMin - 1 / S,
            y: Y(whiteTop + whiteH),
            width: a.rightX / S - xMin + 2 / S,
            height: whiteH / S,
            color: rgb(1, 1, 1),
          });
          page.drawText(safe, { x: x0, y: Y(a.baseY), size, font: f, color: col });
          break;
        }
        page.drawRectangle({
          x: X(a.x) - 1 / S,
          y: Y(whiteTop + whiteH),
          width: (a.w + 2) / S,
          height: whiteH / S,
          color: rgb(1, 1, 1),
        });
        const lines = wrapToWidth(safe, (a.w + 4) / S, (w) => f.widthOfTextAtSize(w, size), f.widthOfTextAtSize(" ", size));
        lines.forEach((line, i) => {
          page.drawText(line, { x: X(a.x), y: Y(a.baseY + i * a.size * 1.2), size, font: f, color: col });
        });
        break;
      }
      case "image": {
        const isPng = a.dataUrl.startsWith("data:image/png");
        const bytes = Uint8Array.from(atob(a.dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
        const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        page.drawImage(img, { x: X(a.x), y: Y(a.y + a.h), width: a.w / S, height: a.h / S });
        break;
      }
    }
  }
  void degrees;
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
