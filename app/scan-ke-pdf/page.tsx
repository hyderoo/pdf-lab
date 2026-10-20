"use client";

import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { downloadBlob, formatBytes } from "@/lib/pdf";
import { ArrowUp, ArrowDown, X, ImageIcon } from "lucide-react";

async function cleanScan(file: File, mode: "bw" | "color"): Promise<Uint8Array> {
  let blob: Blob = file;
  if (file.name.toLowerCase().endsWith(".heic") || file.type === "image/heic") {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    blob = Array.isArray(converted) ? converted[0] : converted;
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const maxSide = 2000;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mode === "bw") {
      let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // contrast stretch + slight lift of whites, like a scanner cleanup
      v = (v - 128) * 1.35 + 148;
      v = Math.max(0, Math.min(255, v));
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      for (let c = 0; c < 3; c++) {
        let v = d[i + c];
        v = (v - 128) * 1.15 + 138;
        d[i + c] = Math.max(0, Math.min(255, v));
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function ScanKePdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<"bw" | "color">("bw");
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
      for (const f of files) {
        const jpeg = await cleanScan(f, mode);
        const img = await doc.embedJpg(jpeg);
        const landscape = img.width > img.height;
        const pw = landscape ? 841.89 : 595.28;
        const ph = landscape ? 595.28 : 841.89;
        const page = doc.addPage([pw, ph]);
        const scale = Math.min(pw / img.width, ph / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: pw / 2 - w / 2, y: ph / 2 - h / 2, width: w, height: h });
      }
      const bytes = await doc.save();
      setResult({ blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), name: "scan.pdf" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat scan PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Scan ke PDF"
      description="Ubah foto halaman kertas menjadi PDF yang rapi seperti hasil scanner: kontras dinaikkan, latar diputihkan."
    >
      <FileDrop
        accept="image/jpeg,image/png,image/webp,image/heic,.heic"
        multiple
        onFiles={(fs) => { setFiles((prev) => [...prev, ...fs]); setResult(null); }}
        label="Tarik & letakkan foto dokumen di sini"
        hint="Foto lurus dan terang memberi hasil terbaik"
      />

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
              <ImageIcon size={16} className="shrink-0 text-blue-400" />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{i + 1}. {f.name}</span>
              <span className="text-xs text-slate-500">{formatBytes(f.size)}</span>
              <button onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:bg-panel2" title="Naik"><ArrowUp size={15} /></button>
              <button onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:bg-panel2" title="Turun"><ArrowDown size={15} /></button>
              <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:bg-panel2 hover:text-rose-400" title="Hapus"><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 max-w-xs">
        <FieldLabel>Mode pembersihan</FieldLabel>
        <Select value={mode} onChange={(e) => setMode(e.target.value as "bw" | "color")}>
          <option value="bw">Hitam putih (dokumen teks)</option>
          <option value="color">Berwarna (ada gambar/warna penting)</option>
        </Select>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={run} disabled={files.length === 0} busy={busy}>
          Buat scan PDF
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
