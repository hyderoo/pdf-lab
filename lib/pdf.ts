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
    .replace(/[\u2022\u25CF\u25AA\u25E6\u2219\u2043\u2023]/g, "-")
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

export type TextSeg = { t: string; b: boolean };

export type TextBlock = {
  kind: "name" | "heading" | "bullet" | "para";
  text: string; // full left/main text (segments joined)
  date?: string; // right-aligned tail on the same visual row
  dateBold?: boolean;
  size: number;
  bold: boolean; // mostly-bold block
  page: number;
  align?: "center" | "left";
  segments?: TextSeg[]; // mixed bold/regular runs, join("") === text
};

export type ExtractedDoc = {
  blocks: TextBlock[];
  layout: {
    pageWidth: number;
    pageHeight: number;
    marginLeft: number;
    marginRight: number;
    startY: number;
    pageCount: number;
  };
};

// Scan raw PDF bytes for /BaseFont names in file order as a bold fallback
// for embedded subset fonts whose flags pdf.js does not expose.
function scanBaseFontBold(raw: ArrayBuffer): boolean[] | null {
  try {
    const bytes = new Uint8Array(raw);
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192)
      s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const re = /\/BaseFont\s*\/([A-Za-z0-9+\-_.]+)/g;
    const seen = new Set<string>();
    const out: boolean[] = [];
    let m;
    while ((m = re.exec(s))) {
      const name = m[1]; // keep subset prefix: distinct subsets are distinct fonts
      if (seen.has(name)) continue; // same font dict referenced twice
      seen.add(name);
      const bare = name.replace(/^[A-Z]{6}\+/, "");
      out.push(/bold|black|semibold|demi|heavy/i.test(bare));
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// Extract structured blocks with position and style info, for the
// translate-and-rerender pipeline.
export async function extractBlocks(
  doc: PDFDocumentProxy,
  raw?: ArrayBuffer
): Promise<ExtractedDoc> {
  type Part = { x: number; w: number; str: string; bold: boolean };
  type Row = { x: number; y: number; h: number; parts: Part[] };
  type Line = {
    text: string;
    segments: TextSeg[];
    date?: string;
    dateBold?: boolean;
    x: number;
    y: number;
    endX: number; // right edge incl. date column
    leftEndX: number; // right edge of the left text only
    h: number;
    boldCover: number; // 0..1 share of bold chars
    markerBullet: boolean;
    page: number;
  };
  type Item = { str: string; x: number; y: number; h: number; w: number; fontName: string };

  const baseBold = raw ? scanBaseFontBold(raw) : null;
  let pageWidth = 595.28;
  let pageHeight = 841.89;

  // Pass 1: pull text items per page and resolve font boldness.
  const pagesItems: Item[][] = [];
  const fontRefs: string[] = []; // first-seen order
  const fontState = new Map<string, boolean | undefined>();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pageWidth = vp.width;
    pageHeight = vp.height;
    // getOperatorList forces all referenced fonts to finish loading into
    // commonObjs, otherwise commonObjs.get throws "not resolved yet".
    await page.getOperatorList();
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const str = cleanGlyphs(it.str);
      if (!str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
      const w = it.width || str.length * h * 0.5;
      items.push({ str, x, y, h, w, fontName: it.fontName });
      if (it.fontName && !fontState.has(it.fontName)) {
        fontRefs.push(it.fontName);
        let b: boolean | undefined;
        try {
          const f = (await page.commonObjs.get(it.fontName)) as
            | { bold?: boolean; black?: boolean; loadedName?: string }
            | undefined;
          if (typeof f?.bold === "boolean" || typeof f?.black === "boolean") {
            b = Boolean(f?.bold || f?.black);
          } else if (f?.loadedName && /bold|black|semibold|demi|heavy/i.test(f.loadedName)) {
            b = true;
          }
        } catch {
          b = undefined;
        }
        fontState.set(it.fontName, b);
      }
    }
    pagesItems.push(items);
  }
  // Bold fallback: no usable flags anywhere -> use /BaseFont names in order.
  const anyKnown = [...fontState.values()].some((v) => v !== undefined);
  const fontBold = new Map<string, boolean>();
  fontRefs.forEach((ref, idx) => {
    const known = fontState.get(ref);
    fontBold.set(ref, known ?? (baseBold && baseBold.length === fontRefs.length ? baseBold[idx] : false));
  });

  // Pass 2: rows -> lines with real widths.
  const allLines: Line[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const rows: Row[] = [];
    for (const it of pagesItems[i - 1]) {
      const bold = fontBold.get(it.fontName) ?? false;
      let row = rows[rows.length - 1];
      if (!row || Math.abs(row.y - it.y) > Math.max(2, row.h * 0.4)) {
        row = { x: it.x, y: it.y, h: it.h, parts: [] };
        rows.push(row);
      }
      if (it.h > row.h) row.h = it.h;
      row.parts.push({ x: it.x, w: it.w, str: it.str, bold });
    }

    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      // Split off a right-hand column (dates) at the first wide interior gap.
      let splitAt = -1;
      let prevEnd = -1;
      for (let k = 0; k < r.parts.length; k++) {
        const p = r.parts[k];
        if (prevEnd >= 0) {
          const gap = p.x - prevEnd;
          if (gap > r.h * 2.2) {
            const rest = r.parts
              .slice(k)
              .map((q) => q.str)
              .join(" ")
              .trim();
            if (/\d{4}|present|sekarang/i.test(rest) || gap > r.h * 8) {
              splitAt = k;
              break;
            }
          }
        }
        prevEnd = p.x + p.w;
      }
      const leftParts = splitAt >= 0 ? r.parts.slice(0, splitAt) : r.parts;
      const rightParts = splitAt >= 0 ? r.parts.slice(splitAt) : [];

      const joinParts = (parts: Part[]): { text: string; segments: TextSeg[] } => {
        let text = "";
        const segments: TextSeg[] = [];
        let prevEnd = -1;
        for (const p of parts) {
          const seg = p.str.replace(/[ \t]+/g, " ");
          if (!seg.trim()) continue;
          const gap = prevEnd >= 0 ? p.x - prevEnd : 0;
          const needSpace = text.length > 0 && gap > 1 && !text.endsWith(" ") && !seg.startsWith(" ");
          const piece = (needSpace ? " " : "") + seg;
          text += piece;
          const last = segments[segments.length - 1];
          if (last && last.b === p.bold) last.t += piece;
          else segments.push({ t: piece, b: p.bold });
          prevEnd = p.x + p.w;
        }
        text = text.trim();
        if (segments.length) {
          segments[0].t = segments[0].t.replace(/^\s+/, "");
          segments[segments.length - 1].t = segments[segments.length - 1].t.replace(/\s+$/, "");
        }
        return { text, segments: segments.filter((s) => s.t.length > 0) };
      };

      const left = joinParts(leftParts);
      if (!left.text) continue;
      const right = rightParts.length ? joinParts(rightParts) : null;
      const boldChars = left.segments.filter((s) => s.b).reduce((n, s) => n + s.t.length, 0);
      const markerBullet = /^[-*]\s+/.test(left.text);
      if (markerBullet) {
        left.segments[0].t = left.segments[0].t.replace(/^[-*]\s+/, "");
        left.text = left.segments.map((s) => s.t).join("");
      }
      allLines.push({
        text: left.text,
        segments: left.segments,
        date: right?.text || undefined,
        dateBold: right ? right.segments.some((s) => s.b) : undefined,
        x: r.x,
        y: r.y,
        endX: Math.max(...r.parts.map((p) => p.x + p.w)),
        leftEndX: Math.max(...leftParts.map((p) => p.x + p.w)),
        h: r.h,
        boldCover: left.text.length ? boldChars / left.text.length : 0,
        markerBullet,
        page: i,
      });
    }
  }

  // Document-wide margins.
  const marginLeft = Math.min(...allLines.map((l) => l.x));
  const rightEdge = Math.max(...allLines.map((l) => l.endX));
  const maxChars = Math.max(...allLines.map((l) => l.text.length), 1);
  const firstPageLines = allLines.filter((l) => l.page === 1);
  const startY = firstPageLines.length
    ? Math.max(...firstPageLines.map((l) => l.y + l.h))
    : pageHeight - 50;

  // Merge wrapped lines into blocks.
  type BlockInt = TextBlock & { _x: number; boldCover: number };
  const blocks: BlockInt[] = [];
  for (let li = 0; li < allLines.length; li++) {
    const ln = allLines[li];
    const prevLn = li > 0 ? allLines[li - 1] : undefined;
    const prev = blocks[blocks.length - 1];
    const indent = ln.x - marginLeft;
    const indentBullet = !ln.markerBullet && indent >= 5 && indent <= 24;
    const prevFull =
      !!prevLn &&
      prevLn.page === ln.page &&
      (prevLn.leftEndX > rightEdge - 35 ||
        (prevLn.text.length >= maxChars * 0.8 && prevLn.leftEndX > rightEdge * 0.72));
    const prevWasBulletContent =
      !!prev && prev.kind === "bullet" && !!prevLn && Math.abs(prevLn.x - ln.x) <= 3;

    const sameBlock =
      !!prev &&
      prev.page === ln.page &&
      !ln.markerBullet &&
      !ln.date &&
      !prev.date &&
      prev.kind !== "name" &&
      prev.kind !== "heading" &&
      !(indentBullet && !(prevWasBulletContent && prevFull)) &&
      Math.abs(prev.size - ln.h) / Math.max(prev.size, ln.h) <= 0.15 &&
      Math.abs(ln.x - prev._x) <= 3 &&
      prevFull &&
      !!prevLn &&
      prevLn.y - ln.y <= ln.h * 1.6;

    if (sameBlock && prev) {
      const hyphenWrap = prev.text.endsWith("-");
      prev.text += (hyphenWrap ? "" : " ") + ln.text;
      const segs = prev.segments ?? (prev.segments = [{ t: prev.text.slice(0, prev.text.length - ln.text.length - 1), b: prev.bold }]);
      const last = segs[segs.length - 1];
      const first = ln.segments[0];
      const sep = hyphenWrap ? "" : " ";
      if (last && first && last.b === first.b) {
        last.t += sep + first.t;
        segs.push(...ln.segments.slice(1));
      } else {
        if (last && first) last.t += sep;
        segs.push(...ln.segments);
      }
      const boldChars = segs.filter((s) => s.b).reduce((n, s) => n + s.t.length, 0);
      prev.boldCover = boldChars / Math.max(1, prev.text.length);
      continue;
    }

    const centered =
      ln.x > marginLeft + 15 &&
      ln.endX < rightEdge - 12 &&
      Math.abs(ln.x - (pageWidth - ln.endX)) < 25;
    blocks.push({
      kind: ln.markerBullet || indentBullet ? "bullet" : "para",
      text: ln.text,
      date: ln.date,
      dateBold: ln.dateBold,
      size: ln.h,
      bold: ln.boldCover >= 0.8,
      page: ln.page,
      align: centered ? "center" : "left",
      segments: ln.segments,
      _x: ln.x,
      boldCover: ln.boldCover,
    });
  }

  // Classify name/headings.
  const bodySize =
    blocks.map((b) => b.size).sort((a, b) => a - b)[Math.floor(blocks.length / 2)] || 11;
  blocks.forEach((b, idx) => {
    const short = b.text.length <= 60;
    const letters = b.text.replace(/[^A-Za-z]/g, "");
    const caps = letters.length >= 3 && b.text === b.text.toUpperCase();
    if (idx === 0 && short && b.size >= bodySize) b.kind = "name";
    else if (b.kind === "para" && !b.date && short && (caps || b.boldCover >= 0.8)) b.kind = "heading";
  });

  return {
    blocks: blocks.map(({ _x, boldCover, ...b }) => {
      void _x;
      void boldCover;
      return b;
    }),
    layout: {
      pageWidth,
      pageHeight,
      marginLeft,
      marginRight: Math.max(20, pageWidth - rightEdge),
      startY,
      pageCount: doc.numPages,
    },
  };
}
