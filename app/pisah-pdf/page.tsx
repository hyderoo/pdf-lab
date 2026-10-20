"use client";

import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName, parsePageRange } from "@/lib/pdf";

type Mode = "rentang" | "per-halaman" | "ekstrak";

export default function PisahPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<Mode>("rentang");
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note?: string } | null>(null);

  const onFile = async (f: File) => {
    setFile(f);
    setResult(null);
    setError("");
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      setPageCount(doc.getPageCount());
    } catch {
      setError("PDF tidak bisa dibaca (mungkin terproteksi).");
      setFile(null);
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const srcBytes = await file.arrayBuffer();
      const base = baseName(file.name);

      if (mode === "per-halaman") {
        const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
        const zip = new JSZip();
        for (let i = 0; i < src.getPageCount(); i++) {
          const doc = await PDFDocument.create();
          const [p] = await doc.copyPages(src, [i]);
          doc.addPage(p);
          zip.file(`${base}-halaman-${i + 1}.pdf`, await doc.save());
        }
        const blob = await zip.generateAsync({ type: "blob" });
        setResult({ blob, name: `${base}-per-halaman.zip`, note: `${src.getPageCount()} berkas PDF dalam satu ZIP.` });
      } else if (mode === "rentang") {
        const groups = range.split(",").map((s) => s.trim()).filter(Boolean);
        if (groups.length === 0) throw new Error("Isi rentang halaman, mis. 1-3, 4-6.");
        const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
        const zip = new JSZip();
        for (const g of groups) {
          const pages = parsePageRange(g, src.getPageCount());
          if (!pages) throw new Error(`Rentang tidak valid: "${g}".`);
          const doc = await PDFDocument.create();
          const copied = await doc.copyPages(src, pages.map((p) => p - 1));
          copied.forEach((p) => doc.addPage(p));
          zip.file(`${base}-${g.replace(/\s+/g, "")}.pdf`, await doc.save());
        }
        const blob = await zip.generateAsync({ type: "blob" });
        setResult({ blob, name: `${base}-rentang.zip`, note: `${groups.length} berkas PDF dalam satu ZIP.` });
      } else {
        const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
        const pages = parsePageRange(range, src.getPageCount());
        if (!pages) throw new Error("Rentang tidak valid. Contoh: 1-3, 5, 8-10.");
        const doc = await PDFDocument.create();
        const copied = await doc.copyPages(src, pages.map((p) => p - 1));
        copied.forEach((p) => doc.addPage(p));
        const bytes = await doc.save();
        setResult({
          blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
          name: `${base}-ekstrak.pdf`,
          note: `${pages.length} halaman diekstrak.`,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memisahkan PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Pisah PDF"
      description="Pisahkan PDF berdasarkan rentang halaman, setiap halaman, atau ekstrak halaman terpilih menjadi satu berkas."
    >
      {!file ? (
        <FileDrop
          accept="application/pdf"
          onFiles={(fs) => fs[0] && onFile(fs[0])}
          label="Pilih satu PDF untuk dipisah"
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-300">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Mode</FieldLabel>
              <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="rentang">Rentang halaman (tiap rentang jadi PDF sendiri)</option>
                <option value="per-halaman">Setiap halaman jadi satu PDF</option>
                <option value="ekstrak">Ekstrak halaman terpilih jadi satu PDF</option>
              </Select>
            </div>
            {mode !== "per-halaman" && (
              <div>
                <FieldLabel>Halaman (maks. {pageCount})</FieldLabel>
                <TextInput
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder={mode === "rentang" ? "mis. 1-3, 4-6, 7" : "mis. 1-3, 5, 8-10"}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy} disabled={mode !== "per-halaman" && !range.trim()}>
              Pisahkan
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setRange(""); setError(""); }}>
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
          note={result.note}
          onDownload={() => downloadBlob(result.blob, result.name)}
        />
      )}
    </ToolShell>
  );
}
