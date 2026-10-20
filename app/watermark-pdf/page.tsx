"use client";

import { useState } from "react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName, parsePageRange } from "@/lib/pdf";

export default function WatermarkPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [kind, setKind] = useState<"teks" | "gambar">("teks");
  const [text, setText] = useState("DRAFT");
  const [image, setImage] = useState<File | null>(null);
  const [fontSize, setFontSize] = useState("64");
  const [imageScale, setImageScale] = useState("30");
  const [opacity, setOpacity] = useState("0.25");
  const [rotation, setRotation] = useState("45");
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
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const op = Math.min(1, Math.max(0.05, parseFloat(opacity) || 0.25));
      const rot = parseFloat(rotation) || 0;

      let embedded: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
      if (kind === "gambar") {
        if (!image) throw new Error("Pilih gambar watermark dulu (PNG atau JPG).");
        const bytes = await image.arrayBuffer();
        embedded = image.type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      }

      let targets = doc.getPageIndices();
      if (range.trim()) {
        const pages = parsePageRange(range, doc.getPageCount());
        if (!pages) throw new Error("Rentang tidak valid. Contoh: 1-5, 8.");
        targets = pages.map((p) => p - 1);
      }

      for (const i of targets) {
        const page = doc.getPage(i);
        const { width, height } = page.getSize();
        if (kind === "teks") {
          const size = Math.max(8, parseInt(fontSize, 10) || 64);
          const w = font.widthOfTextAtSize(text, size);
          page.drawText(text, {
            x: width / 2 - w / 2,
            y: height / 2 - size / 3,
            size,
            font,
            color: rgb(0.55, 0.58, 0.62),
            opacity: op,
            rotate: degrees(rot),
          });
        } else if (embedded) {
          const targetW = (width * Math.min(90, parseInt(imageScale, 10) || 30)) / 100;
          const scale = targetW / embedded.width;
          const w = embedded.width * scale;
          const h = embedded.height * scale;
          page.drawImage(embedded, {
            x: width / 2 - w / 2,
            y: height / 2 - h / 2,
            width: w,
            height: h,
            opacity: op,
            rotate: degrees(rot),
          });
        }
      }
      const bytes = await doc.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-watermark.pdf`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menambah watermark.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Watermark PDF"
      description="Tambahkan watermark teks atau gambar dengan ukuran, rotasi, dan transparansi pilihan ke semua halaman atau sebagian halaman."
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
              <FieldLabel>Jenis watermark</FieldLabel>
              <Select value={kind} onChange={(e) => setKind(e.target.value as "teks" | "gambar")}>
                <option value="teks">Teks</option>
                <option value="gambar">Gambar (PNG/JPG)</option>
              </Select>
            </div>
            {kind === "teks" ? (
              <>
                <div className="sm:col-span-2">
                  <FieldLabel>Teks</FieldLabel>
                  <TextInput value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>Ukuran huruf</FieldLabel>
                  <TextInput type="number" min={8} max={200} value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="sm:col-span-2">
                  <FieldLabel>Gambar</FieldLabel>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => setImage(e.target.files?.[0] ?? null)}
                    className="w-full rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-accent file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                  />
                </div>
                <div>
                  <FieldLabel>Lebar (% halaman)</FieldLabel>
                  <TextInput type="number" min={5} max={90} value={imageScale} onChange={(e) => setImageScale(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <FieldLabel>Transparansi (0.05–1)</FieldLabel>
              <TextInput type="number" step="0.05" min={0.05} max={1} value={opacity} onChange={(e) => setOpacity(e.target.value)} />
            </div>
            <div>
              <FieldLabel>Rotasi (derajat)</FieldLabel>
              <Select value={rotation} onChange={(e) => setRotation(e.target.value)}>
                <option value="0">0° (datar)</option>
                <option value="45">45° (diagonal)</option>
                <option value="-45">-45° (diagonal balik)</option>
                <option value="90">90° (tegak)</option>
              </Select>
            </div>
            <div>
              <FieldLabel>Halaman (kosongkan = semua)</FieldLabel>
              <TextInput value={range} onChange={(e) => setRange(e.target.value)} placeholder="mis. 1-5, 8" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy} disabled={kind === "teks" ? !text.trim() : !image}>
              Tambahkan watermark
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); }}>
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
