"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { loadPdfJsDoc, downloadBlob, formatBytes, baseName, parsePageRange } from "@/lib/pdf";

type Rect = { x: number; y: number; w: number; h: number };

export default function CropPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [jsDoc, setJsDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    setRect(null);
    try {
      const buf = await f.arrayBuffer();
      const doc = await loadPdfJsDoc(buf.slice(0));
      setFile(f);
      setJsDoc(doc);
      setPageCount(doc.numPages);
      setPreviewPage(1);
    } catch {
      setError("PDF tidak bisa dibaca.");
    }
  };

  useEffect(() => {
    if (!jsDoc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const page = await jsDoc.getPage(previewPage);
      const v0 = page.getViewport({ scale: 1 });
      const maxW = Math.min(560, window.innerWidth - 48);
      const scale = maxW / v0.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [jsDoc, previewPage]);

  const canvasPos = (e: React.MouseEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const onDown = (e: React.MouseEvent) => {
    startRef.current = canvasPos(e);
    setRect(null);
  };
  const onMove = (e: React.MouseEvent) => {
    if (!startRef.current) return;
    const p = canvasPos(e);
    const s = startRef.current;
    setRect({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  };
  const onUp = () => {
    startRef.current = null;
  };

  const run = async () => {
    if (!file || !rect || !canvasRef.current) return;
    setBusy(true);
    setError("");
    try {
      if (rect.w < 10 || rect.h < 10) throw new Error("Area crop terlalu kecil. Seret untuk memilih area.");
      const c = canvasRef.current;
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      let targets = doc.getPageIndices();
      if (range.trim()) {
        const pages = parsePageRange(range, doc.getPageCount());
        if (!pages) throw new Error("Rentang tidak valid. Contoh: 1-5, 8.");
        targets = pages.map((p) => p - 1);
      }
      for (const i of targets) {
        const page = doc.getPage(i);
        const { width, height } = page.getSize();
        const sx = width / c.width;
        const sy = height / c.height;
        const x = rect.x * sx;
        const w = rect.w * sx;
        const h = rect.h * sy;
        const y = height - rect.y * sy - h;
        page.setCropBox(x, y, w, h);
        page.setMediaBox(x, y, w, h);
      }
      const bytes = await doc.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-crop.pdf`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal crop PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Crop PDF"
      description="Pilih area pada halaman lalu crop satu halaman atau semua halaman. Konten di luar area hanya disembunyikan, tidak dihapus permanen."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-300">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-3 grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Halaman pratinjau</FieldLabel>
              <Select value={previewPage} onChange={(e) => { setPreviewPage(parseInt(e.target.value, 10)); setRect(null); }}>
                {[...Array(pageCount)].map((_, i) => (
                  <option key={i} value={i + 1}>Halaman {i + 1}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>Terapkan ke halaman (kosongkan = semua)</FieldLabel>
              <TextInput value={range} onChange={(e) => setRange(e.target.value)} placeholder="mis. 1-5, 8" />
            </div>
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Seret di atas gambar halaman untuk memilih area yang dipertahankan.
          </p>
          <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-line">
            <canvas
              ref={canvasRef}
              className="block max-w-full cursor-crosshair"
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            />
            {rect && canvasRef.current && (
              <div
                className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/15"
                style={{
                  left: `${(rect.x / canvasRef.current.width) * 100}%`,
                  top: `${(rect.y / canvasRef.current.height) * 100}%`,
                  width: `${(rect.w / canvasRef.current.width) * 100}%`,
                  height: `${(rect.h / canvasRef.current.height) * 100}%`,
                }}
              />
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy} disabled={!rect}>
              Crop
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setJsDoc(null); setResult(null); setRect(null); setRange(""); setError(""); }}>
              Ganti berkas
            </SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <ResultCard
          filename={result.name}
          sizeLabel={formatBytes(result.blob.size)}
          onDownload={() => downloadBlob(result.blob, result.name)}
        />
      )}
    </ToolShell>
  );
}
