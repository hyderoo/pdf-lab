"use client";

import { useEffect, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select, TextInput } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";

async function loadBitmap(file: File): Promise<ImageBitmap> {
  let blob: Blob = file;
  if (file.name.toLowerCase().endsWith(".heic") || file.type === "image/heic") {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 });
    blob = Array.isArray(converted) ? converted[0] : converted;
  }
  return createImageBitmap(blob);
}

function encode(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), type, q)
  );
}

function draw(bmp: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // JPG has no transparency
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return c;
}

export default function KompresFoto() {
  const [file, setFile] = useState<File | null>(null);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [targetVal, setTargetVal] = useState("200");
  const [targetUnit, setTargetUnit] = useState("KB");
  const [format, setFormat] = useState("image/jpeg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note: string; warn?: string; url: string } | null>(null);

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    try {
      const b = await loadBitmap(f);
      setBmp(b);
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f.type === "image/heic" ? new Blob() : f));
    } catch {
      setError("Foto tidak bisa dibaca. Coba JPG, PNG, WebP, atau HEIC.");
    }
  };

  const run = async () => {
    if (!file || !bmp) return;
    setError("");
    setResult(null);
    const v = parseFloat(targetVal.replace(",", "."));
    if (!isFinite(v) || v <= 0) {
      setError("Isi ukuran maksimal dengan angka lebih dari 0, misalnya 200 KB.");
      return;
    }
    const target = Math.round(v * (targetUnit === "MB" ? 1000 * 1000 : 1000));
    setBusy(true);
    try {
      let scale = 1;
      let best: Blob | null = null;
      let bestDims = { w: bmp.width, h: bmp.height };
      let bestQ = 0;
      for (let round = 0; round < 12 && !best; round++) {
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = draw(bmp, w, h);
        // binary search quality at this size
        let lo = 0.3;
        let hi = 0.95;
        let fit: Blob | null = null;
        let fitQ = 0;
        const top = await encode(canvas, format, hi);
        if (top.size <= target) {
          fit = top;
          fitQ = hi;
        } else {
          const bottom = await encode(canvas, format, lo);
          if (bottom.size <= target) {
            fit = bottom;
            fitQ = lo;
            for (let i = 0; i < 7; i++) {
              const mid = (lo + hi) / 2;
              const b = await encode(canvas, format, mid);
              if (b.size <= target) {
                fit = b;
                fitQ = mid;
                lo = mid;
              } else hi = mid;
            }
          }
        }
        if (fit) {
          best = fit;
          bestDims = { w, h };
          bestQ = fitQ;
        } else {
          scale *= 0.85;
        }
      }
      if (!best) {
        setError("Tidak bisa mencapai ukuran itu. Coba target yang lebih besar.");
        return;
      }
      const ext = format === "image/webp" ? "webp" : "jpg";
      const shrink = bestDims.w / bmp.width;
      const warnings: string[] = [];
      if (shrink < 0.6) warnings.push(`Resolusi dikecilkan jadi ${Math.round(shrink * 100)}% dari aslinya (${bestDims.w}x${bestDims.h}). Wajah atau tulisan kecil bisa kurang jelas.`);
      if (bestQ < 0.5) warnings.push("Kualitas kompresi rendah, cek hasilnya sebelum diunggah.");
      if (best.size > file.size) warnings.push("Hasilnya lebih besar dari foto asli (format berbeda).");
      const url = URL.createObjectURL(best);
      setResult({
        blob: best,
        name: `${baseName(file.name)}-kompres.${ext}`,
        url,
        note: `${formatBytes(file.size)} → ${formatBytes(best.size)} (target ${formatBytes(target)}), ${bestDims.w}x${bestDims.h}px, kualitas ${Math.round(bestQ * 100)}%.`,
        warn: warnings.join(" "),
      });
    } catch {
      setError("Gagal mengompres foto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Kompres Foto"
      description="Kecilkan foto sampai di bawah batas ukuran, misalnya maksimal 200 KB untuk upload pas foto atau KTP. Resolusi hanya dikecilkan kalau perlu. Hitungan konservatif: 1 KB = 1000 byte, jadi lolos di pengecekan 1000 maupun 1024."
    >
      {!file ? (
        <FileDrop
          accept="image/jpeg,image/png,image/webp,image/heic,.heic"
          onFiles={(fs) => fs[0] && onFile(fs[0])}
          label="Pilih satu foto"
          hint="JPG, PNG, WebP, HEIC. Diproses di browser kamu."
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {bmp?.width}x{bmp?.height}px · {formatBytes(file.size)}
          </p>
          <div className="mb-4 grid max-w-xl gap-4 sm:grid-cols-3">
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
            <div>
              <FieldLabel>Format hasil</FieldLabel>
              <Select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="image/jpeg">JPG (paling umum)</option>
                <option value="image/webp">WebP (lebih kecil)</option>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Kompres</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setBmp(null); setResult(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
          {previewUrl && !result && file.type !== "image/heic" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Foto asli" className="mt-4 max-h-64 rounded-lg border border-line" />
          )}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result?.warn && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{result.warn}</p>
      )}
      {result && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.url} alt="Hasil kompres" className="mt-4 max-h-64 rounded-lg border border-line" />
          <ResultCard
            filename={result.name}
            sizeLabel={formatBytes(result.blob.size)}
            note={result.note}
            onDownload={() => downloadBlob(result.blob, result.name)}
          />
        </>
      )}
    </ToolShell>
  );
}
