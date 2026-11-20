"use client";

import { useEffect, useRef, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";

// Same vendored ffmpeg.wasm as Kompres Video (same-origin only, CSP-safe).
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

/** Accepts "5.25", "05.250", "1:05.250", "01:02:05.250". Returns seconds or null. */
function parseTime(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!/^\d+(\.\d+)?$/.test(parts[i])) return null;
    if (i < parts.length - 1 && parts[i].includes(".")) return null;
    total = total * 60 + parseFloat(parts[i]);
  }
  return total;
}

function formatTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${h > 0 ? p(h) + ":" : ""}${p(m)}:${p(s)}.${p(r, 3)}`;
}

export default function PotongVideo() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState("00:00.000");
  const [end, setEnd] = useState("");
  const [mode, setMode] = useState("presisi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note?: string } | null>(null);
  const ffmpegRef = useRef<FFmpegLike | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const onFile = (f: File) => {
    setError("");
    setResult(null);
    setFile(f);
    setDuration(0);
    setStart("00:00.000");
    setEnd("");
    setUrl(URL.createObjectURL(f));
  };

  const reset = () => {
    setFile(null);
    setUrl("");
    setResult(null);
    setError("");
    setProgress("");
  };

  const loadFfmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (!window.FFmpegWASM) await loadScript(FFMPEG_JS);
    const FFmpegCtor = window.FFmpegWASM?.FFmpeg;
    if (!FFmpegCtor) throw new Error("ffmpeg gagal dimuat.");
    const ffmpeg = new FFmpegCtor();
    ffmpeg.on("progress", ({ progress: p }) => {
      if (p > 0 && p <= 1) setProgress(`Memotong... ${Math.round(p * 100)}%`);
    });
    setProgress("Memuat mesin video (sekali saja, ~30 MB)...");
    await ffmpeg.load({ coreURL: CORE_JS, wasmURL: CORE_WASM });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const setFromPlayer = (which: "start" | "end") => {
    const t = videoRef.current?.currentTime ?? 0;
    if (which === "start") setStart(formatTime(t));
    else setEnd(formatTime(t));
  };

  const run = async () => {
    if (!file) return;
    setError("");
    setResult(null);
    const s = parseTime(start);
    const e = end.trim() ? parseTime(end) : duration || null;
    if (s === null || e === null) {
      setError("Format waktu tidak valid. Contoh: 00:05.250, 1:02:03.5, atau 5.25 (detik).");
      return;
    }
    if (duration && (s >= duration || e > duration + 0.001)) {
      setError(`Waktu di luar durasi video (${formatTime(duration)}).`);
      return;
    }
    if (e <= s) {
      setError("Waktu akhir harus lebih besar dari waktu mulai.");
      return;
    }
    setBusy(true);
    try {
      const ffmpeg = await loadFfmpeg();
      const dot = file.name.lastIndexOf(".");
      const ext = dot >= 0 ? file.name.slice(dot) : ".mp4";
      const input = `input${ext}`;
      const outName = mode === "presisi" ? "output.mp4" : `output${ext}`;
      await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      setProgress("Memotong...");
      const common = ["-ss", s.toFixed(3), "-i", input, "-t", (e - s).toFixed(3)];
      const args =
        mode === "presisi"
          ? [...common, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outName]
          : [...common, "-c", "copy", "-avoid_negative_ts", "make_zero", outName];
      const code = await ffmpeg.exec(args);
      if (code !== 0) throw new Error("ffmpeg gagal memproses video ini.");
      const data = await ffmpeg.readFile(outName);
      const bytes = new Uint8Array(data);
      if (bytes.length === 0) throw new Error("ffmpeg menghasilkan berkas kosong.");
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: mode === "presisi" ? "video/mp4" : file.type || "video/mp4",
      });
      await ffmpeg.deleteFile(input);
      await ffmpeg.deleteFile(outName);
      setResult({
        blob,
        name: `${baseName(file.name)}-potong${mode === "presisi" ? ".mp4" : ext}`,
        note: `${formatTime(s)} sampai ${formatTime(e)} (${formatTime(e - s)})`,
      });
      setProgress("");
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("ffmpeg")
          ? err.message
          : "Gagal memotong. Video terlalu besar untuk memori browser, atau formatnya tidak didukung. Coba video yang lebih kecil."
      );
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Potong Video"
      description="Potong video dari waktu mulai sampai waktu akhir, sampai milidetik, langsung di browser. Video tidak pernah diunggah."
    >
      {!file && (
        <FileDrop
          accept="video/*"
          onFiles={(fs) => fs[0] && onFile(fs[0])}
          label="Pilih satu video"
          hint="MP4, WebM, MOV, MKV. Diproses di browser kamu."
        />
      )}
      {file && (
        <>
          <p className="text-sm text-slate-600">
            {file.name} - {formatBytes(file.size)}
            {duration > 0 ? ` - durasi ${formatTime(duration)}` : ""}
          </p>
          <video
            ref={videoRef}
            src={url}
            controls
            onLoadedMetadata={(ev) => {
              const d = ev.currentTarget.duration;
              if (isFinite(d)) {
                setDuration(d);
                setEnd((cur) => cur || formatTime(d));
              }
            }}
            className="w-full max-h-80 rounded-lg bg-black"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Mulai (mm:ss.mmm)</FieldLabel>
              <TextInput value={start} onChange={(e) => setStart(e.target.value)} placeholder="00:05.250" inputMode="decimal" />
              <button type="button" onClick={() => setFromPlayer("start")} className="mt-1 text-xs text-blue-700 underline">
                Pakai posisi video sekarang
              </button>
            </div>
            <div>
              <FieldLabel>Akhir (mm:ss.mmm)</FieldLabel>
              <TextInput value={end} onChange={(e) => setEnd(e.target.value)} placeholder="00:12.800" inputMode="decimal" />
              <button type="button" onClick={() => setFromPlayer("end")} className="mt-1 text-xs text-blue-700 underline">
                Pakai posisi video sekarang
              </button>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Mode</FieldLabel>
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="presisi">Presisi (encode ulang ke MP4, potongan sesuai frame, lebih lambat)</option>
                <option value="cepat">Cepat (tanpa encode ulang, awal bisa bergeser ke keyframe terdekat)</option>
              </Select>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Waktu bisa diisi sampai milidetik. Hasil potongan akurat sampai batas frame video (misalnya sekitar 33 ms pada 30 fps), bukan lebih kecil dari satu frame.
          </p>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton onClick={run} busy={busy}>
              Potong video
            </PrimaryButton>
            <SecondaryButton onClick={reset}>Ganti berkas</SecondaryButton>
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
