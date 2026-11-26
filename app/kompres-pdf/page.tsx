"use client";

import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select, TextInput } from "@/components/ui";
import { loadPdfJsDoc, renderPageCanvas, downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";

// scale = render scale (1 = 72 dpi), q = JPEG quality. Ordered best to smallest.
const LADDER: { scale: number; q: number }[] = [
  { scale: 2, q: 0.85 },
  { scale: 1.7, q: 0.75 },
  { scale: 1.45, q: 0.65 },
  { scale: 1.25, q: 0.55 },
  { scale: 1.1, q: 0.45 },
  { scale: 0.95, q: 0.4 },
  { scale: 0.8, q: 0.35 },
  { scale: 0.65, q: 0.3 },
];
// From this level on, small text is likely hard to read.
const READABLE_LIMIT = 4;

async function build(src: PDFDocumentProxy, scale: number, q: number, onPage?: (i: number, n: number) => void) {
  const out = await PDFDocument.create();
  for (let i = 1; i <= src.numPages; i++) {
    onPage?.(i, src.numPages);
    const canvas = await renderPageCanvas(src, i, scale);
    const dataUrl = canvas.toDataURL("image/jpeg", q);
    const bin = atob(dataUrl.split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    const img = await out.embedJpg(bytes);
    const page = out.addPage([img.width / scale, img.height / scale]);
    page.drawImage(img, { x: 0, y: 0, width: img.width / scale, height: img.height / scale });
    canvas.width = 0;
  }
  return out.save();
}

export default function KompresPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState("target");
  const [quality, setQuality] = useState("sedang");
  const [targetVal, setTargetVal] = useState("200");
  const [targetUnit, setTargetUnit] = useState("KB");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note?: string; warn?: string } | null>(null);

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
    setError("");
    setResult(null);
    let targetBytes = 0;
    if (mode === "target") {
      const v = parseFloat(targetVal.replace(",", "."));
      if (!isFinite(v) || v <= 0) {
        setError("Isi ukuran target dengan angka lebih dari 0, misalnya 200 KB.");
        return;
      }
      targetBytes = Math.round(v * (targetUnit === "MB" ? 1000 * 1000 : 1000));
      if (file.size <= targetBytes) {
        setError(`PDF ini sudah ${formatBytes(file.size)}, sudah di bawah target ${formatBytes(targetBytes)}. Tidak perlu dikompres.`);
        return;
      }
    }
    setBusy(true);
    try {
      const src = await loadPdfJsDoc(await file.arrayBuffer());
      const onPage = (label: string) => (i: number, n: number) => setProgress(`${label} halaman ${i} dari ${n}...`);
      let pdfBytes: Uint8Array;
      let warn = "";
      let note = "";
      if (mode === "target") {
        // Binary search over the ladder for the best level that still fits the target.
        let lo = 0;
        let hi = LADDER.length - 1;
        let best: { idx: number; bytes: Uint8Array } | null = null;
        let tries = 0;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          tries++;
          const bytes = await build(src, LADDER[mid].scale, LADDER[mid].q, onPage(`Percobaan ${tries}: memproses`));
          if (bytes.length <= targetBytes) {
            best = { idx: mid, bytes };
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        if (best) {
          pdfBytes = best.bytes;
          if (best.idx >= READABLE_LIMIT) {
            warn = "Kualitas sudah diturunkan cukup jauh supaya muat di target. Cek hasilnya: tulisan kecil bisa jadi sulit dibaca.";
          }
        } else {
          pdfBytes = await build(src, LADDER[LADDER.length - 1].scale, LADDER[LADDER.length - 1].q);
          warn = `Target ${formatBytes(targetBytes)} tidak tercapai walau kualitas sudah paling rendah (hasil ${formatBytes(pdfBytes.length)}) dan tulisan kemungkinan sulit dibaca. Coba target lebih besar, atau pisahkan PDF jadi beberapa bagian.`;
        }
        note = `${formatBytes(file.size)} → ${formatBytes(pdfBytes.length)} (target ${formatBytes(targetBytes)}).`;
      } else {
        const level = quality === "kecil" ? LADDER[3] : quality === "sedang" ? LADDER[2] : LADDER[0];
        pdfBytes = await build(src, level.scale, level.q, onPage("Memproses"));
        const pct = Math.round((1 - pdfBytes.length / file.size) * 100);
        note = `${formatBytes(file.size)} → ${formatBytes(pdfBytes.length)}${pct > 0 ? ` (hemat ${pct}%)` : ""}.`;
        if (pdfBytes.length >= file.size) warn = "Hasilnya tidak lebih kecil dari aslinya. PDF ini sudah efisien; pakai berkas asli.";
      }
      setResult({
        blob: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-kompres.pdf`,
        note: `${note} Halaman menjadi gambar: teks tidak bisa diseleksi/dicari.`,
        warn,
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
      description="Kecilkan ukuran PDF: pilih ukuran target (misalnya maksimal 200 KB) atau tingkat kompresi. Halaman diubah menjadi gambar terkompresi, jadi teks hasilnya tidak bisa diseleksi atau dicari."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel>Cara kompres</FieldLabel>
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="target">Sesuai ukuran target (maksimal ... KB / MB)</option>
                <option value="level">Pilih tingkat kompresi</option>
              </Select>
            </div>
            {mode === "target" ? (
              <>
                <div>
                  <FieldLabel>Ukuran maksimal</FieldLabel>
                  <TextInput value={targetVal} onChange={(e) => setTargetVal(e.target.value)} inputMode="decimal" placeholder="200" />
                </div>
                <div>
                  <FieldLabel>Satuan</FieldLabel>
                  <Select value={targetUnit} onChange={(e) => setTargetUnit(e.target.value)}>
                    <option value="KB">KB</option>
                    <option value="MB">MB</option>
                  </Select>
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">
                  Kualitas diturunkan seperlunya sampai hasilnya muat di target. Hitungannya konservatif (1 KB = 1000 byte), jadi lolos di pengecekan 1000 maupun 1024. Kalau tulisan jadi sulit dibaca, kamu akan diberi peringatan.
                </p>
              </>
            ) : (
              <div className="sm:col-span-2">
                <FieldLabel>Tingkat kompresi</FieldLabel>
                <Select value={quality} onChange={(e) => setQuality(e.target.value)}>
                  <option value="kecil">Ukuran terkecil (kualitas turun)</option>
                  <option value="sedang">Seimbang</option>
                  <option value="bagus">Kualitas terbaik (ukuran lebih besar)</option>
                </Select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Kompres</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
          {progress && <p className="mt-3 text-xs text-slate-500">{progress}</p>}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result?.warn && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{result.warn}</p>
      )}
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
