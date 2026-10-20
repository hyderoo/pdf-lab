"use client";

import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { loadPdfJsDoc, renderPageCanvas, downloadBlob, formatBytes, baseName } from "@/lib/pdf";

export default function KompresPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [quality, setQuality] = useState("sedang");
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
      const src = await loadPdfJsDoc(await file.arrayBuffer());
      const out = await PDFDocument.create();
      const q = quality === "kecil" ? 0.5 : quality === "sedang" ? 0.65 : 0.8;
      const scale = quality === "kecil" ? 1.2 : quality === "sedang" ? 1.5 : 2;
      for (let i = 1; i <= src.numPages; i++) {
        setProgress(`Memproses halaman ${i} dari ${src.numPages}…`);
        const canvas = await renderPageCanvas(src, i, scale);
        const dataUrl = canvas.toDataURL("image/jpeg", q);
        const b64 = dataUrl.split(",")[1];
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        const img = await out.embedJpg(bytes);
        const page = out.addPage([img.width / scale, img.height / scale]);
        page.drawImage(img, { x: 0, y: 0, width: img.width / scale, height: img.height / scale });
      }
      const pdfBytes = await out.save();
      const before = formatBytes(file.size);
      const after = formatBytes(pdfBytes.length);
      const pct = Math.round((1 - pdfBytes.length / file.size) * 100);
      setResult({
        blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-kompres.pdf`,
        note: `${before} → ${after}${pct > 0 ? ` (hemat ${pct}%)` : ""}. Halaman menjadi gambar: teks tidak bisa diseleksi/dicari.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengompres PDF.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <ToolShell
      title="Kompres PDF"
      description="Kecilkan ukuran PDF dengan mengubah halaman menjadi gambar terkompresi. Cocok untuk scan besar; teks hasilnya tidak bisa diseleksi atau dicari."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 max-w-xs">
            <FieldLabel>Tingkat kompresi</FieldLabel>
            <Select value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="kecil">Ukuran terkecil (kualitas turun)</option>
              <option value="sedang">Seimbang</option>
              <option value="bagus">Kualitas terbaik (ukuran lebih besar)</option>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Kompres</PrimaryButton>
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
