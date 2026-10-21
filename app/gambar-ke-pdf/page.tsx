"use client";

import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { downloadBlob, formatBytes } from "@/lib/pdf";
import { ArrowUp, ArrowDown, X, ImageIcon } from "lucide-react";

async function toJpegBytes(file: File, quality = 0.92): Promise<Uint8Array> {
  let blob: Blob = file;
  if (file.name.toLowerCase().endsWith(".heic") || file.type === "image/heic") {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality });
    blob = Array.isArray(converted) ? converted[0] : converted;
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function GambarKePdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState("a4");
  const [margin, setMargin] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const move = (i: number, dir: -1 | 1) =>
    setFiles((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const doc = await PDFDocument.create();
      const m = Math.max(0, parseInt(margin, 10) || 0);
      for (const f of files) {
        const jpeg = await toJpegBytes(f);
        const img = await doc.embedJpg(jpeg);
        let pw: number, ph: number;
        if (pageSize === "a4") {
          const landscape = img.width > img.height;
          pw = landscape ? 841.89 : 595.28;
          ph = landscape ? 595.28 : 841.89;
        } else {
          pw = img.width + m * 2;
          ph = img.height + m * 2;
        }
        const page = doc.addPage([pw, ph]);
        const availW = pw - m * 2;
        const availH = ph - m * 2;
        const scale = Math.min(availW / img.width, availH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: pw / 2 - w / 2, y: ph / 2 - h / 2, width: w, height: h });
      }
      const bytes = await doc.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: "gambar.pdf",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah gambar menjadi PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Gambar ke PDF"
      description="Gabungkan foto atau hasil scan (JPG, PNG, WebP, HEIC) menjadi satu PDF. Atur urutan, ukuran halaman, dan margin."
    >
      <FileDrop
        accept="image/jpeg,image/png,image/webp,image/heic,.heic"
        multiple
        onFiles={(fs) => { setFiles((prev) => [...prev, ...fs]); setResult(null); }}
        label="Tarik & letakkan gambar di sini, atau klik untuk memilih"
        hint="JPG, PNG, WebP, HEIC - bisa banyak sekaligus"
      />

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
              <ImageIcon size={16} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{i + 1}. {f.name}</span>
              <span className="text-xs text-slate-500">{formatBytes(f.size)}</span>
              <button onClick={() => move(i, -1)} className="rounded p-1 text-slate-500 hover:bg-panel2" title="Naik"><ArrowUp size={15} /></button>
              <button onClick={() => move(i, 1)} className="rounded p-1 text-slate-500 hover:bg-panel2" title="Turun"><ArrowDown size={15} /></button>
              <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="rounded p-1 text-slate-500 hover:bg-panel2 hover:text-rose-600" title="Hapus"><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Ukuran halaman</FieldLabel>
          <Select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
            <option value="a4">A4 (orientasi mengikuti gambar)</option>
            <option value="fit">Pas ukuran gambar</option>
          </Select>
        </div>
        <div>
          <FieldLabel>Margin (pt)</FieldLabel>
          <Select value={margin} onChange={(e) => setMargin(e.target.value)}>
            <option value="0">Tanpa margin</option>
            <option value="24">Kecil (24 pt)</option>
            <option value="48">Sedang (48 pt)</option>
          </Select>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={run} disabled={files.length === 0} busy={busy}>
          Buat PDF {files.length > 0 ? `dari ${files.length} gambar` : ""}
        </PrimaryButton>
        {files.length > 0 && (
          <SecondaryButton onClick={() => { setFiles([]); setResult(null); setError(""); }}>Ulang dari awal</SecondaryButton>
        )}
      </div>
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
