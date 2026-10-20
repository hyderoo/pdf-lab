"use client";

import { useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName, parsePageRange } from "@/lib/pdf";

const positions = [
  ["bawah-tengah", "Bawah tengah"],
  ["bawah-kanan", "Bawah kanan"],
  ["bawah-kiri", "Bawah kiri"],
  ["atas-tengah", "Atas tengah"],
  ["atas-kanan", "Atas kanan"],
  ["atas-kiri", "Atas kiri"],
] as const;

export default function NomorHalaman() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState("n");
  const [position, setPosition] = useState<string>("bawah-tengah");
  const [fontSize, setFontSize] = useState("11");
  const [startAt, setStartAt] = useState("1");
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const onFile = async (f: File) => {
    setFile(f);
    setResult(null);
    setError("");
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      setPageCount(doc.getPageCount());
    } catch {
      setError("PDF tidak bisa dibaca.");
      setFile(null);
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const size = Math.max(6, parseInt(fontSize, 10) || 11);
      const start = parseInt(startAt, 10) || 1;
      const total = doc.getPageCount();
      let targets = doc.getPageIndices();
      if (range.trim()) {
        const pages = parsePageRange(range, total);
        if (!pages) throw new Error("Rentang tidak valid. Contoh: 2-10.");
        targets = pages.map((p) => p - 1);
      }
      const margin = 24;
      for (const i of targets) {
        const page = doc.getPage(i);
        const { width, height } = page.getSize();
        const n = i + start;
        const label =
          format === "n" ? `${n}` : format === "n-of-total" ? `${n} / ${total + start - 1}` : `Halaman ${n}`;
        const textWidth = font.widthOfTextAtSize(label, size);
        let x = width / 2 - textWidth / 2;
        if (position.endsWith("kanan")) x = width - margin - textWidth;
        if (position.endsWith("kiri")) x = margin;
        const y = position.startsWith("atas") ? height - margin - size : margin;
        page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.28, 0.33) });
      }
      const bytes = await doc.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-nomor.pdf`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menambah nomor halaman.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Nomor Halaman"
      description="Tambahkan nomor halaman dengan format, posisi, dan huruf pilihan ke semua halaman atau sebagian halaman."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <div>
              <FieldLabel>Format</FieldLabel>
              <Select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="n">1, 2, 3…</option>
                <option value="n-of-total">1 / 12, 2 / 12…</option>
                <option value="halaman-n">Halaman 1, Halaman 2…</option>
              </Select>
            </div>
            <div>
              <FieldLabel>Posisi</FieldLabel>
              <Select value={position} onChange={(e) => setPosition(e.target.value)}>
                {positions.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>Ukuran huruf</FieldLabel>
              <TextInput type="number" min={6} max={48} value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
            </div>
            <div>
              <FieldLabel>Nomor awal</FieldLabel>
              <TextInput type="number" min={0} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Halaman (kosongkan = semua)</FieldLabel>
              <TextInput value={range} onChange={(e) => setRange(e.target.value)} placeholder="mis. 2-10 (hal. 1 untuk sampul)" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Tambahkan nomor</PrimaryButton>
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
          onDownload={() => downloadBlob(result.blob, result.name)}
        />
      )}
    </ToolShell>
  );
}
