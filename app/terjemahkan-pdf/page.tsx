"use client";

import { useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { loadPdfJsDoc, extractBlocks, downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { blocksToPdf } from "@/lib/textPdf";

export default function TerjemahkanPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [target, setTarget] = useState("id");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

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
    setResult(null);
    try {
      setProgress("Mengekstrak struktur dokumen...");
      const doc = await loadPdfJsDoc(await file.arrayBuffer());
      const blocks = await extractBlocks(doc);
      const texts = blocks.map((b) => (b.date ? `${b.text}  ${b.date}` : b.text));
      if (!texts.join("").trim()) throw new Error("PDF ini tidak punya teks (mungkin hasil scan tanpa OCR).");

      setProgress(`Menerjemahkan ${texts.length} blok dengan AI...`);
      const resp = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "translateBlocks", blocks: texts, targetLang: target }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Gagal menerjemahkan.");
      const translated: string[] = data.result;

      setProgress("Menyusun ulang PDF...");
      const out = blocks.map((b, i) => {
        let text = translated[i] ?? b.text;
        let date = b.date;
        // The block was sent with its date appended; split the translated tail
        // back off so the date can be right-aligned again.
        if (date && text.endsWith(date)) {
          text = text.slice(0, text.length - date.length).trim();
        } else {
          date = undefined; // model merged the date inline; keep as-is
        }
        return { ...b, text, date };
      });
      const first = await doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      const minX = Math.min(...blocks.map((b) => (b as unknown as { _x?: number })._x ?? 56), 56);
      const blob = await blocksToPdf(out, { width: vp.width, height: vp.height }, minX);
      const lang = target === "en" ? "inggris" : "indonesia";
      const name = `${baseName(file.name)}-${lang}.pdf`;
      setResult({ blob, name });
      downloadBlob(blob, name);
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menerjemahkan PDF.");
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Terjemahkan PDF"
      description="Terjemahkan isi PDF antara bahasa Indonesia dan Inggris dengan AI, lalu unduh hasilnya sebagai PDF dengan struktur yang dipertahankan."
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
              <option value="id">Bahasa Indonesia</option>
              <option value="en">Bahasa Inggris</option>
            </Select>
          </div>
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            Teks PDF diekstrak di browser, diterjemahkan per blok oleh Google Gemini, lalu disusun ulang
            sebagai PDF dengan struktur yang dipertahankan. Berkas PDF asli tidak pernah diunggah.
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>
              {busy ? "Menerjemahkan…" : "Terjemahkan & unduh PDF"}
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); setProgress(""); }}>
              Ganti berkas
            </SecondaryButton>
          </div>
        </>
      )}
      {progress && <p className="mt-3 text-sm text-slate-500">{progress}</p>}
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <ResultCard
          filename={result.name}
          sizeLabel={formatBytes(result.blob.size)}
          note="Unduhan dimulai otomatis. Klik Unduh untuk mengunduh ulang."
          onDownload={() => downloadBlob(result.blob, result.name)}
        />
      )}
    </ToolShell>
  );
}
