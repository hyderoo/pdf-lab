"use client";

import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName, parsePageRange } from "@/lib/pdf";

export default function PutarPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [angle, setAngle] = useState("90");
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
      const add = parseInt(angle, 10);
      let targets = doc.getPageIndices();
      if (range.trim()) {
        const pages = parsePageRange(range, doc.getPageCount());
        if (!pages) throw new Error("Rentang tidak valid. Contoh: 1-3, 5.");
        targets = pages.map((p) => p - 1);
      }
      for (const i of targets) {
        const page = doc.getPage(i);
        page.setRotation(degrees((page.getRotation().angle + add) % 360));
      }
      const bytes = await doc.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-diputar.pdf`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memutar PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Putar PDF"
      description="Putar semua halaman atau halaman tertentu sebesar 90°, 180°, atau 270° tanpa mengubah isi halaman."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF untuk diputar" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-300">
            {file.name} · {pageCount} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Sudut putar</FieldLabel>
              <Select value={angle} onChange={(e) => setAngle(e.target.value)}>
                <option value="90">90° searah jarum jam</option>
                <option value="180">180°</option>
                <option value="270">270° (90° berlawanan jarum jam)</option>
              </Select>
            </div>
            <div>
              <FieldLabel>Halaman (kosongkan = semua)</FieldLabel>
              <TextInput value={range} onChange={(e) => setRange(e.target.value)} placeholder="mis. 1-3, 5" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Putar</PrimaryButton>
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
