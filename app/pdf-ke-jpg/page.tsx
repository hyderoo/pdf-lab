"use client";

import { useState } from "react";
import JSZip from "jszip";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { loadPdfJsDoc, renderPageCanvas, downloadBlob, formatBytes, baseName } from "@/lib/pdf";

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal membuat gambar."))), type, quality)
  );
}

export default function PdfKeJpg() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [scale, setScale] = useState("2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note?: string } | null>(null);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    try {
      const buf = await f.arrayBuffer();
      const doc = await loadPdfJsDoc(buf.slice(0));
      setFile(f);
      setPageCount(doc.numPages);
    } catch {
      setError("PDF tidak bisa dibaca.");
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const doc = await loadPdfJsDoc(await file.arrayBuffer());
      const base = baseName(file.name);
      const ext = format === "jpeg" ? "jpg" : "png";
      const s = parseFloat(scale) || 2;
      const zip = new JSZip();
      for (let i = 1; i <= doc.numPages; i++) {
        setProgress(`Merender halaman ${i} dari ${doc.numPages}…`);
        const canvas = await renderPageCanvas(doc, i, s);
        const blob = await canvasToBlob(canvas, `image/${format}`, 0.9);
        zip.file(`${base}-halaman-${i}.${ext}`, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      setResult({ blob: out, name: `${base}-${ext}.zip`, note: `${doc.numPages} gambar ${ext.toUpperCase()} dalam satu ZIP.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah PDF menjadi gambar.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <ToolShell
      title="PDF ke JPG"
      description="Ubah setiap halaman PDF menjadi gambar JPG atau PNG."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Format gambar</FieldLabel>
              <Select value={format} onChange={(e) => setFormat(e.target.value as "jpeg" | "png")}>
                <option value="jpeg">JPG (lebih kecil)</option>
                <option value="png">PNG (lebih tajam)</option>
              </Select>
            </div>
            <div>
              <FieldLabel>Resolusi</FieldLabel>
              <Select value={scale} onChange={(e) => setScale(e.target.value)}>
                <option value="1">Normal (1x)</option>
                <option value="2">Tinggi (2x)</option>
                <option value="3">Sangat tinggi (3x)</option>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Ubah jadi gambar</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
          {progress && <p className="mt-3 text-xs text-slate-500">{progress}</p>}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <ResultCard
          filename={result.name}
          sizeLabel={formatBytes(result.blob.size)}
          note={result.note}
          onDownload={() => downloadBlob(result.blob, result.name)}
        />
      )}
    </ToolShell>
  );
}
