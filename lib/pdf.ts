"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function loadPdfJsDoc(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({ data }).promise;
}

export async function renderPageThumb(
  doc: PDFDocumentProxy,
  pageNum: number,
  targetWidth = 160
): Promise<string> {
  const page = await doc.getPage(pageNum);
  const viewport0 = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport0.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toDataURL("image/jpeg", 0.8);
}

export async function renderPageCanvas(
  doc: PDFDocumentProxy,
  pageNum: number,
  scale: number
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

// Map symbol-font / private-use bullet glyphs (tofu boxes) and unicode
// bullets to a plain "-", and odd spaces to regular spaces.
function cleanGlyphs(s: string): string {
  return s
    .replace(/[\uF0B7\uF0A7\uF076\uF0D8\uF0FC\uF0A8\uF0E0\uF06C\uF06E]/g, "-")
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/[\u2022\u25CF\u25AA\u25E6\u2219\u00B7\u2043\u2023]/g, "-")
    .replace(/[\u00A0\u2007\u202F]/g, " ");
}

// Reconstruct lines and paragraph breaks from positioned text items,
// instead of collapsing the whole page into one space-joined blob.
export async function extractAllText(doc: PDFDocumentProxy): Promise<string[]> {
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let cur = "";
    let lastY: number | null = null;
    let lastH = 0;
    let lineStartX: number | null = null;
    const flush = () => {
      const t = cur.replace(/[ \t]+/g, " ").trim();
      if (t) lines.push(t);
      cur = "";
      lineStartX = null;
    };
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const str = cleanGlyphs(it.str);
      if (!str) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 0;
      const startsBullet = /^[-*]\s/.test(str.trimStart());
      if (lastY !== null) {
        const dy = Math.abs(y - lastY);
        const hPrev = lastH > 0 ? lastH : 10;
        const sizeChanged = h > 0 && lastH > 0 && Math.abs(h - lastH) / lastH > 0.25;
        const indentChanged = lineStartX !== null && Math.abs(x - lineStartX) > 20;
        if (dy > hPrev * 1.7) {
          flush();
          if (lines.length && lines[lines.length - 1] !== "") lines.push(""); // paragraph gap
        } else if (
          cur &&
          dy > Math.max(2, hPrev * 0.5) &&
          (startsBullet || indentChanged || sizeChanged)
        ) {
          flush(); // real boundary: new bullet, indent, or font size
        }
        // otherwise: same paragraph wrapping - keep accumulating (join)
      }
      if (cur && !cur.endsWith(" ") && !str.startsWith(" ")) cur += " ";
      if (!cur) lineStartX = x;
      cur += str;
      lastY = y;
      if (h > 0) lastH = h;
    }
    flush();
    pages.push(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim());
  }
  return pages;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function parsePageRange(input: string, max: number): number[] | null {
  const out = new Set<number>();
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a < 1 || b > max || a > b) return null;
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n < 1 || n > max) return null;
      out.add(n);
    } else {
      return null;
    }
  }
  return [...out].sort((x, y) => x - y);
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export type TextBlock = {
  kind: "name" | "heading" | "bullet" | "para";
  text: string; // left/main text
  date?: string; // right-aligned tail on the same visual row
  size: number;
  bold: boolean;
  page: number;
};

// Extract structured blocks with position and style info, for the
// translate-and-rerender pipeline.
export async function extractBlocks(doc: PDFDocumentProxy): Promise<TextBlock[]> {
  const blocks: TextBlock[] = [];
  let globalIndex = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    // getOperatorList forces all referenced fonts to finish loading into
    // commonObjs, otherwise commonObjs.get throws "not resolved yet".
    await page.getOperatorList();
    const content = await page.getTextContent();
    // Resolve font objects for bold detection (FontFaceObject exposes
    // prototype getters `bold` / `black` and a `loadedName` string).
    const fontBold = new Map<string, boolean>();
    for (const it of content.items) {
      if ("str" in it && it.fontName && !fontBold.has(it.fontName)) {
        try {
          const f = (await page.commonObjs.get(it.fontName)) as
            | { bold?: boolean; black?: boolean; loadedName?: string }
            | undefined;
          fontBold.set(
            it.fontName,
            Boolean(f?.bold || f?.black || /bold|black|semibold|demi/i.test(f?.loadedName ?? ""))
          );
        } catch {
          fontBold.set(it.fontName, false);
        }
      }
    }
    type Row = { x: number; y: number; h: number; bold: boolean; parts: { x: number; str: string }[] };
    const rows: Row[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const str = cleanGlyphs(it.str);
      if (!str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
      const bold = fontBold.get(it.fontName) ?? false;
      let row = rows[rows.length - 1];
      if (!row || Math.abs(row.y - y) > Math.max(2, row.h * 0.4)) {
        row = { x, y, h, bold, parts: [] };
        rows.push(row);
      }
      if (h > row.h) row.h = h;
      if (bold) row.bold = true;
      row.parts.push({ x, str });
    }
    // Build per-row text; split left/right on large interior x-gaps.
    type Line = { text: string; date?: string; x: number; y: number; h: number; bold: boolean; bullet: boolean };
    const lines: Line[] = [];
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let left = "";
      let right = "";
      let lastX = r.x;
      let lastW = 0;
      for (const p of r.parts) {
        const gap = p.x - (lastX + lastW);
        const seg = p.str.replace(/[ \t]+/g, " ").trim();
        if (!seg) continue;
        if (left && gap > r.h * 3 && !right) {
          right = seg; // wide interior gap -> right column (usually dates)
        } else if (right) {
          right += " " + seg;
        } else {
          left += (left ? " " : "") + seg;
        }
        lastX = p.x;
        lastW = p.str.length * r.h * 0.5; // rough width estimate
      }
      const bullet = /^[-*]\s+/.test(left);
      lines.push({ text: left, date: right || undefined, x: r.x, y: r.y, h: r.h, bold: r.bold, bullet });
    }
    // Merge wrapped lines into blocks.
    for (const ln of lines) {
      const prev = blocks[blocks.length - 1];
      const sameBlock =
        prev &&
        prev.page === i &&
        !ln.bullet &&
        !ln.date &&
        !prev.date &&
        Math.abs(prev.size - ln.h) / Math.max(prev.size, ln.h) <= 0.15 &&
        Math.abs(ln.x - prevX(prev)) < 20 &&
        prev.kind !== "name" &&
        prev.kind !== "heading" &&
        prevYGap(prev, ln) <= ln.h * 1.6;
      if (sameBlock) {
        prev.text += " " + ln.text;
      } else {
        blocks.push({
          kind: ln.bullet ? "bullet" : "para",
          text: ln.bullet ? ln.text.replace(/^[-*]\s+/, "") : ln.text,
          date: ln.date,
          size: ln.h,
          bold: ln.bold,
          page: i,
        });
        (blocks[blocks.length - 1] as unknown as { _x: number })._x = ln.x;
        (blocks[blocks.length - 1] as unknown as { _y: number })._y = ln.y;
      }
      globalIndex++;
    }
  }
  // Classify name/headings.
  const bodySize =
    blocks.map((b) => b.size).sort((a, b) => a - b)[Math.floor(blocks.length / 2)] || 11;
  blocks.forEach((b, idx) => {
    const short = b.text.length <= 60;
    const letters = b.text.replace(/[^A-Za-z]/g, "");
    const caps = letters.length >= 3 && b.text === b.text.toUpperCase();
    if (idx === 0 && short && b.size >= bodySize) b.kind = "name";
    else if (b.kind === "para" && !b.date && short && (caps || b.bold)) b.kind = "heading";
    void globalIndex;
  });
  return blocks;
}
function prevX(b: TextBlock): number {
  return (b as unknown as { _x?: number })._x ?? 0;
}
function prevYGap(prev: TextBlock, ln: { y: number }): number {
  const py = (prev as unknown as { _y?: number })._y ?? ln.y;
  return Math.abs(py - ln.y);
}
