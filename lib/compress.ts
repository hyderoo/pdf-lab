"use client";

import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPageCanvas } from "@/lib/pdf";

export async function loadBitmap(file: File): Promise<ImageBitmap> {
  let blob: Blob = file;
  if (file.name.toLowerCase().endsWith(".heic") || file.type === "image/heic") {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 });
    blob = Array.isArray(converted) ? converted[0] : converted;
  }
  return createImageBitmap(blob);
}

const encode = (c: HTMLCanvasElement, type: string, q: number): Promise<Blob> =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), type, q));

/** Shrinks a photo under `target` bytes. Quality first, then resolution. */
export async function compressPhoto(bmp: ImageBitmap, target: number, type: string) {
  let scale = 1;
  for (let round = 0; round < 12; round++) {
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    let lo = 0.3;
    let hi = 0.95;
    const top = await encode(c, type, hi);
    if (top.size <= target) return { blob: top, q: hi, w, h, shrink: scale };
    const bottom = await encode(c, type, lo);
    if (bottom.size <= target) {
      let fit = bottom;
      let fq = lo;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        const b = await encode(c, type, mid);
        if (b.size <= target) { fit = b; fq = mid; lo = mid; } else hi = mid;
      }
      return { blob: fit, q: fq, w, h, shrink: scale };
    }
    scale *= 0.85;
  }
  return null;
}

export const PDF_LADDER = [
  { scale: 2, q: 0.85 }, { scale: 1.7, q: 0.75 }, { scale: 1.45, q: 0.65 }, { scale: 1.25, q: 0.55 },
  { scale: 1.1, q: 0.45 }, { scale: 0.95, q: 0.4 }, { scale: 0.8, q: 0.35 }, { scale: 0.65, q: 0.3 },
];

export async function buildRaster(src: PDFDocumentProxy, scale: number, q: number) {
  const out = await PDFDocument.create();
  for (let i = 1; i <= src.numPages; i++) {
    const canvas = await renderPageCanvas(src, i, scale);
    const bin = atob(canvas.toDataURL("image/jpeg", q).split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    const img = await out.embedJpg(bytes);
    const page = out.addPage([img.width / scale, img.height / scale]);
    page.drawImage(img, { x: 0, y: 0, width: img.width / scale, height: img.height / scale });
    canvas.width = 0;
  }
  return out.save();
}

/** Returns best bytes under target, or the smallest attempt with fit=false. */
export async function compressPdfToTarget(src: PDFDocumentProxy, target: number) {
  let lo = 0;
  let hi = PDF_LADDER.length - 1;
  let best: { idx: number; bytes: Uint8Array } | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const bytes = await buildRaster(src, PDF_LADDER[mid].scale, PDF_LADDER[mid].q);
    if (bytes.length <= target) { best = { idx: mid, bytes }; hi = mid - 1; } else lo = mid + 1;
  }
  if (best) return { bytes: best.bytes, fit: true, low: best.idx >= 4 };
  const last = PDF_LADDER[PDF_LADDER.length - 1];
  return { bytes: await buildRaster(src, last.scale, last.q), fit: false, low: true };
}
