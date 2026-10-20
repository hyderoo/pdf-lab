"use client";

import { useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ErrorNote } from "@/components/ui";
import { loadPdfJsDoc, extractAllText, downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { textToPdf } from "@/lib/textPdf";
import { Download } from "lucide-react";

export default function RingkasPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [extracted, setExtracted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  const onFile = async (f: File) => {
    setError("");
    setSummary("");
    setExtracted("");
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
      let text = extracted;
      if (!text) {
        const doc = await loadPdfJsDoc(await file.arrayBuffer());
        const pages = await extractAllText(doc);
        text = pages.join("\n\n");
        if (!text.trim()) throw new Error("PDF ini tidak punya teks (mungkin hasil scan tanpa OCR).");
        setExtracted(text);
      }
      const resp = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "summarize", text: text.slice(0, 120000) }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Gagal meringkas.");
      setSummary(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal meringkas PDF.");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!file || !summary) return;
    const blob = await textToPdf(`Ringkasan — ${baseName(file.name)}`, summary);
    downloadBlob(blob, `${baseName(file.name)}-ringkasan.pdf`);
  };

  return (
    <ToolShell
      title="Ringkas PDF"
      description="Buat ringkasan isi PDF dengan AI dan unduh hasilnya sebagai PDF."
      ai
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF untuk diringkas" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-300">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-200">
            Saat kamu menekan tombol di bawah, isi teks PDF ini diekstrak di browser lalu
            dikirim ke Google Gemini untuk diringkas. Berkas PDF asli tidak pernah diunggah.
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>
              {busy ? "Meringkas…" : "Kirim teks ke AI & ringkas"}
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setSummary(""); setExtracted(""); setError(""); }}>
              Ganti berkas
            </SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>

      {summary && (
        <div className="mt-6">
          <div className="whitespace-pre-wrap rounded-xl border border-line bg-panel p-5 text-sm leading-relaxed text-slate-200">
            {summary}
          </div>
          <button
            onClick={download}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            <Download size={15} /> Unduh ringkasan sebagai PDF
          </button>
        </div>
      )}
    </ToolShell>
  );
}
