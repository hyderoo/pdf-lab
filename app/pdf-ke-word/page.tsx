"use client";

import { useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote } from "@/components/ui";
import { buildDocx } from "@/lib/docx";
import { loadPdfJsDoc, extractAllText, downloadBlob, formatBytes, baseName } from "@/lib/pdf";

export default function PdfKeWord() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note: string; warn?: string } | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const doc = await loadPdfJsDoc(await file.arrayBuffer());
      const pages = await extractAllText(doc);
      const chars = pages.join("").replace(/\s/g, "").length;
      if (chars < 20 * doc.numPages) {
        setError("Hampir tidak ada teks di PDF ini, kemungkinan hasil scan. PDF ke Word belum membaca gambar. Jalankan OCR PDF (/ocr-pdf) dulu, lalu ubah hasil OCR-nya ke Word.");
        return;
      }
      const blob = await buildDocx(pages);
      setResult({
        blob,
        name: `${baseName(file.name)}.docx`,
        note: `${doc.numPages} halaman, ${chars} karakter teks. Hasil berupa teks per paragraf, tanpa tabel, kolom, gambar, dan font asli.`,
        warn:
          chars < 20 * doc.numPages
            ? "Hampir tidak ada teks di PDF ini, kemungkinan hasil scan. Jalankan OCR PDF dulu, lalu ubah hasilnya ke Word."
            : undefined,
      });
    } catch {
      setError("PDF tidak bisa dibaca atau diubah.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="PDF ke Word"
      description="Ubah teks PDF menjadi dokumen Word (.docx) yang bisa diedit. Hasilnya aproksimasi: teks per paragraf, tanpa tabel, kolom, atau gambar. PDF hasil scan perlu OCR dulu."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && setFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">{file.name} · {formatBytes(file.size)}</p>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Ubah ke Word</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result?.warn && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{result.warn}</p>}
      {result && <ResultCard filename={result.name} sizeLabel={formatBytes(result.blob.size)} note={result.note} onDownload={() => downloadBlob(result.blob, result.name)} />}
    </ToolShell>
  );
}
