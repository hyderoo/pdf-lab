"use client";

import { useRef, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";

// ffmpeg.wasm is vendored in /public/ffmpeg (Turbopack cannot bundle its ESM
// worker, and a CDN worker script is blocked cross-origin). Same-origin only.
const FFMPEG_JS = "/ffmpeg/ffmpeg.js";
const CORE_JS = "/ffmpeg/core/ffmpeg-core.js";
const CORE_WASM = "/ffmpeg/core/ffmpeg-core.wasm";

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegLike };
  }
}

type FFmpegLike = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<boolean>;
  on: (event: "progress", cb: (p: { progress: number }) => void) => void;
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array>;
  deleteFile: (path: string) => Promise<boolean>;
  exec: (args: string[]) => Promise<number>;
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("script"));
    document.head.appendChild(el);
  });
}



type Preset = { crf: string; maxHeight: number; label: string };
const PRESETS: Record<string, Preset> = {
  ringan: { crf: "26", maxHeight: 1080, label: "Ringan (kualitas tinggi, hemat sedang)" },
  sedang: { crf: "30", maxHeight: 720, label: "Sedang (maks. 720p)" },
  kuat: { crf: "34", maxHeight: 480, label: "Kuat (maks. 480p, paling kecil)" },
};

export default function KompresVideo() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState("");
  const [preset, setPreset] = useState("sedang");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note?: string } | null>(null);
  const ffmpegRef = useRef<FFmpegLike | null>(null);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    setFile(f);
    try {
      const url = URL.createObjectURL(f);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = url;
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error("bad"));
      });
      const dur = Math.round(v.duration);
      setMeta(`${f.name} - ${formatBytes(f.size)} - ${v.videoWidth}x${v.videoHeight} - ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`);
      URL.revokeObjectURL(url);
    } catch {
      setMeta(`${f.name} - ${formatBytes(f.size)}`);
    }
  };

  const loadFfmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (!window.FFmpegWASM) await loadScript(FFMPEG_JS);
    const FFmpegCtor = window.FFmpegWASM?.FFmpeg;
    if (!FFmpegCtor) throw new Error("ffmpeg gagal dimuat.");
    const ffmpeg = new FFmpegCtor();
    ffmpeg.on("progress", ({ progress: p }) => {
      if (p > 0 && p <= 1) setProgress(`Mengompres... ${Math.round(p * 100)}%`);
    });
    setProgress("Memuat mesin kompresi (sekali saja, ~30 MB)...");
    await ffmpeg.load({ coreURL: CORE_JS, wasmURL: CORE_WASM });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const ffmpeg = await loadFfmpeg();
      const p = PRESETS[preset];
      const dot = file.name.lastIndexOf(".");
      const input = `input${dot >= 0 ? file.name.slice(dot) : ".mp4"}`;
      await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      setProgress("Mengompres...");
      const args = [
        "-i", input,
        "-vf", `scale=-2:'min(${p.maxHeight},ih)'`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", p.crf,
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        "output.mp4",
      ];
      const code = await ffmpeg.exec(args);
      if (code !== 0) throw new Error("ffmpeg gagal memproses video ini.");
      const data = await ffmpeg.readFile("output.mp4");
      const bytes = new Uint8Array(data);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
      await ffmpeg.deleteFile(input);
      await ffmpeg.deleteFile("output.mp4");
      const before = formatBytes(file.size);
      const after = formatBytes(blob.size);
      const pct = Math.round((1 - blob.size / file.size) * 100);
      setResult({
        blob,
        name: `${baseName(file.name)}-kompres.mp4`,
        note: `${before} → ${after}${pct > 0 ? ` (hemat ${pct}%)` : ""}`,
      });
      setProgress("");
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("ffmpeg")
          ? e.message
          : "Gagal mengompres. Video terlalu besar untuk memori browser, atau formatnya tidak didukung. Coba video yang lebih pendek/kecil."
      );
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Kompres Video"
      description="Kecilkan ukuran video langsung di browser dengan ffmpeg.wasm. Hasilnya MP4 (H.264 + AAC) yang bisa diputar di mana saja."
    >
      {!file && (
        <FileDrop
          accept="video/*"
          onFiles={(fs) => fs[0] && onFile(fs[0])}
          label="Pilih satu video"
          hint="MP4, WebM, MOV, MKV. Video diproses di browser kamu dan tidak pernah diunggah."
        />
      )}
      {file && (
        <>
          <p className="text-sm text-slate-600">{meta}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Tingkat kompresi</FieldLabel>
              <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {Object.entries(PRESETS).map(([k, p]) => (
                  <option key={k} value={k}>{p.label}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Kompresi video di browser itu berat: video panjang atau besar bisa lambat (menit, bukan detik) dan butuh memori besar. Untuk video di atas beberapa ratus MB, kompres di laptop, bukan HP.
          </div>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton onClick={run} busy={busy}>
              Kompres video
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); setProgress(""); }}>
              Ganti berkas
            </SecondaryButton>
          </div>
        </>
      )}
      {progress && <p className="text-sm text-slate-500">{progress}</p>}
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
