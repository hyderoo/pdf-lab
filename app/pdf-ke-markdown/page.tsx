"use client";

import { useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote } from "@/components/ui";
import { loadPdfJsDoc, extractAllText, downloadBlob, formatBytes, baseName } from "@/lib/pdf";

export default function PdfKeMarkdown() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      const pages = await extractAllText(doc);
      const nonEmpty = pages.filter((p) => p.length > 0).length;
      if (nonEmpty === 0) throw new Error("Tidak ada teks yang bisa diekstrak - PDF ini mungkin hasil scan tanpa OCR.");
      const md = pages
        .map((t, i) => `<!-- Halaman ${i + 1} -->\n\n${t}\n`)
        .join("\n---\n\n");
      setResult({
        blob: new Blob([md], { type: "text/markdown" }),
        name: `${baseName(file.name)}.md`,
        note: `${nonEmpty} dari ${pages.length} halaman berisi teks.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengekstrak teks.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="PDF ke Markdown"
      description="Ubah PDF menjadi berkas Markdown (.md). Hanya teks yang diekstrak; PDF hasil scan tanpa OCR tidak punya teks untuk diambil."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Ubah jadi Markdown</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
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
