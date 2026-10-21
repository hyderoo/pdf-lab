"use client";

import { useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { loadPdfJsDoc, extractAllText, downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { textToPdf } from "@/lib/textPdf";
import { Download } from "lucide-react";

export default function TerjemahkanPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [extracted, setExtracted] = useState("");
  const [target, setTarget] = useState("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [translated, setTranslated] = useState("");

  const onFile = async (f: File) => {
    setError("");
    setTranslated("");
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
        body: JSON.stringify({ action: "translate", text: text.slice(0, 120000), targetLang: target }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Gagal menerjemahkan.");
      setTranslated(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menerjemahkan PDF.");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!file || !translated) return;
    const lang = target === "en" ? "inggris" : "indonesia";
    const blob = await textToPdf(null, translated);
    downloadBlob(blob, `${baseName(file.name)}-${lang}.pdf`);
  };

  return (
    <ToolShell
      title="Terjemahkan PDF"
      description="Terjemahkan isi PDF antara bahasa Indonesia dan Inggris dengan AI, lalu unduh hasilnya sebagai PDF. Tata letak asli tidak dipertahankan - hasilnya dokumen teks."
      ai
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF untuk diterjemahkan" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 max-w-xs">
            <FieldLabel>Terjemahkan ke</FieldLabel>
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="en">Bahasa Inggris</option>
              <option value="id">Bahasa Indonesia</option>
            </Select>
          </div>
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            Saat kamu menekan tombol di bawah, isi teks PDF ini diekstrak di browser lalu
            dikirim ke Google Gemini untuk diterjemahkan. Berkas PDF asli tidak pernah diunggah.
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>
              {busy ? "Menerjemahkan…" : "Kirim teks ke AI & terjemahkan"}
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setTranslated(""); setExtracted(""); setError(""); }}>
              Ganti berkas
            </SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>

      {translated && (
        <div className="mt-6">
          <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-panel p-5 text-sm leading-relaxed text-slate-700">
            {translated}
          </div>
          <button
            onClick={download}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            <Download size={15} /> Unduh terjemahan sebagai PDF
          </button>
        </div>
      )}
    </ToolShell>
  );
}
