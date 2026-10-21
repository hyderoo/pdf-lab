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
      const buf = await file.arrayBuffer();
      const doc = await loadPdfJsDoc(buf.slice(0));
      const ext = await extractBlocks(doc, buf.slice(0));
      const blocks = ext.blocks;
      if (!blocks.length) throw new Error("PDF ini tidak punya teks (mungkin hasil scan tanpa OCR).");

      // Flatten to pieces: one array item per bold/regular run and per date,
      // so formatting survives translation without the model seeing markup.
      const pieces: string[] = [];
      const map: { block: number; kind: "seg" | "date"; seg: number }[] = [];
      blocks.forEach((b, bi) => {
        const segs = b.segments && b.segments.length ? b.segments : [{ t: b.text, b: b.bold }];
        segs.forEach((s, si) => {
          if (!s.t.trim()) return;
          pieces.push(s.t.trim());
          map.push({ block: bi, kind: "seg", seg: si });
        });
        if (b.date) {
          pieces.push(b.date);
          map.push({ block: bi, kind: "date", seg: -1 });
        }
      });

      setProgress(`Menerjemahkan ${pieces.length} bagian dengan AI...`);
      const resp = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "translateBlocks", blocks: pieces, targetLang: target }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Gagal menerjemahkan.");
      const translated: string[] = data.result;

      setProgress("Menyusun ulang PDF...");
      const out = blocks.map((b) => ({
        ...b,
        segments: (b.segments && b.segments.length ? b.segments : [{ t: b.text, b: b.bold }]).map((s) => ({ ...s, t: "" })),
        text: "",
        date: b.date,
      }));
      map.forEach((m, i) => {
        const t = (translated[i] ?? pieces[i]).trim();
        const ob = out[m.block];
        if (m.kind === "date") ob.date = t;
        else {
          ob.segments![m.seg].t = t;
        }
      });
      for (const ob of out) {
        ob.segments = ob.segments!.filter((s) => s.t);
        ob.text = ob.segments.map((s) => s.t).join(" ");
        ob.segments.forEach((s, i) => { if (i > 0) s.t = " " + s.t; });
      }
      const blob = await blocksToPdf(out, ext.layout);
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
