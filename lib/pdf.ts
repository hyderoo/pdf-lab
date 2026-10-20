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

export async function extractAllText(doc: PDFDocumentProxy): Promise<string[]> {
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
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
