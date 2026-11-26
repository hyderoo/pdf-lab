"use client";

import { useRef, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote } from "@/components/ui";
import { downloadBlob, formatBytes } from "@/lib/pdf";
import { ArrowUp, ArrowDown, X, Film } from "lucide-react";

// Same vendored ffmpeg.wasm as Kompres Video and Potong Video (same-origin only, CSP-safe).
const FFMPEG_JS = "/ffmpeg/ffmpeg.js";
const CORE_JS = "/ffmpeg/core/ffmpeg-core.js";
const CORE_WASM = "/ffmpeg/core/ffmpeg-core.wasm";

type FFmpegWindow = { FFmpegWASM?: { FFmpeg: new () => FFmpegLike } };

type FFmpegLike = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<boolean>;
  on: (event: string, cb: (p: never) => void) => void;
  off: (event: string, cb: (p: never) => void) => void;
  writeFile: (path: string, data: Uint8Array | string) => Promise<boolean>;
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

function probeSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const u = URL.createObjectURL(file);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const r = { w: v.videoWidth, h: v.videoHeight };
      URL.revokeObjectURL(u);
      if (r.w && r.h) resolve(r);
      else reject(new Error("size"));
    };
    v.onerror = () => {
      URL.revokeObjectURL(u);
      reject(new Error("size"));
    };
    v.src = u;
  });
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export default function GabungVideo() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note: string } | null>(null);
  const ffmpegRef = useRef<FFmpegLike | null>(null);

  const move = (i: number, dir: -1 | 1) => {
    setResult(null);
    setFiles((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const loadFfmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    const w = window as unknown as FFmpegWindow;
    if (!w.FFmpegWASM) await loadScript(FFMPEG_JS);
    const Ctor = w.FFmpegWASM?.FFmpeg;
    if (!Ctor) throw new Error("ffmpeg gagal dimuat.");
    const ffmpeg = new Ctor();
    setProgress("Memuat mesin video (sekali saja, ~30 MB)...");
    await ffmpeg.load({ coreURL: CORE_JS, wasmURL: CORE_WASM });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const hasAudio = async (ffmpeg: FFmpegLike, name: string) => {
    let found = false;
    const onLog = ((e: { message: string }) => {
      if (/Stream #\d+:\d+.*Audio:/.test(e.message)) found = true;
    }) as never;
    ffmpeg.on("log", onLog);
    await ffmpeg.exec(["-hide_banner", "-i", name]);
    ffmpeg.off("log", onLog);
    return found;
  };

  const run = async () => {
    if (files.length < 2) return;
    setError("");
    setResult(null);
    setBusy(true);
    const made: string[] = [];
    try {
      const first = await probeSize(files[0]);
      const scale = Math.min(1, 1280 / Math.max(first.w, first.h));
      const W = even(first.w * scale);
      const H = even(first.h * scale);
      const ffmpeg = await loadFfmpeg();
      const FPS = 30;

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setProgress(`Menyiapkan video ${i + 1} dari ${files.length}...`);
        const dot = f.name.lastIndexOf(".");
        const input = `in${i}${dot >= 0 ? f.name.slice(dot) : ".mp4"}`;
        const part = `part${i}.mp4`;
        await ffmpeg.writeFile(input, new Uint8Array(await f.arrayBuffer()));
        const audio = await hasAudio(ffmpeg, input);
        const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},format=yuv420p`;
        const args = audio
          ? ["-i", input, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", part]
          : ["-i", input, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-vf", vf, "-map", "0:v:0", "-map", "1:a:0", "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", part];
        const onProg = (({ progress: p }: { progress: number }) => {
          if (p > 0 && p <= 1) setProgress(`Menyiapkan video ${i + 1} dari ${files.length}... ${Math.round(p * 100)}%`);
        }) as never;
        ffmpeg.on("progress", onProg);
        const code = await ffmpeg.exec(args);
        ffmpeg.off("progress", onProg);
        await ffmpeg.deleteFile(input);
        if (code !== 0) throw new Error(`ffmpeg gagal memproses "${f.name}".`);
        made.push(part);
      }

      setProgress("Menggabungkan...");
      await ffmpeg.writeFile("list.txt", made.map((p) => `file '${p}'`).join("\n"));
      const code = await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "out.mp4"]);
      if (code !== 0) throw new Error("ffmpeg gagal menggabungkan video.");
      const data = await ffmpeg.readFile("out.mp4");
      const bytes = new Uint8Array(data);
      if (bytes.length === 0) throw new Error("ffmpeg menghasilkan berkas kosong.");
      await ffmpeg.deleteFile("out.mp4");
      await ffmpeg.deleteFile("list.txt");
      for (const p of made) await ffmpeg.deleteFile(p);
      setResult({
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" }),
        name: "video-gabungan.mp4",
        note: `${files.length} video, ${W}x${H}, ${FPS} fps`,
      });
      setProgress("");
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("ffmpeg")
          ? err.message
          : "Gagal menggabungkan. Video terlalu besar untuk memori browser, atau formatnya tidak didukung. Coba video yang lebih kecil."
      );
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Gabung Video"
      description="Gabungkan beberapa video menjadi satu MP4 sesuai urutan yang kamu tentukan, langsung di browser. Video tidak pernah diunggah."
    >
      <FileDrop
        accept="video/*"
        multiple
        onFiles={(fs) => {
          setFiles((prev) => [...prev, ...fs]);
          setResult(null);
        }}
        label="Pilih dua video atau lebih"
        hint="MP4, WebM, MOV, MKV. Bisa pilih banyak sekaligus, atur urutannya di bawah."
      />
      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
              <Film size={16} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                {i + 1}. {f.name}
              </span>
              <span className="text-xs text-slate-500">{formatBytes(f.size)}</span>
              <button onClick={() => move(i, -1)} className="rounded p-1 text-slate-500 hover:bg-panel2" title="Naik">
                <ArrowUp size={15} />
              </button>
              <button onClick={() => move(i, 1)} className="rounded p-1 text-slate-500 hover:bg-panel2" title="Turun">
                <ArrowDown size={15} />
              </button>
              <button
                onClick={() => {
                  setFiles((p) => p.filter((_, k) => k !== i));
                  setResult(null);
                }}
                className="rounded p-1 text-slate-500 hover:bg-panel2"
                title="Hapus"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <>
          <p className="mt-3 text-xs text-slate-500">
            Ukuran layar mengikuti video pertama (maks 1280 px). Video lain diberi bingkai hitam bila rasionya beda. Video tanpa suara tetap bisa digabung.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <PrimaryButton onClick={run} busy={busy} disabled={files.length < 2}>
              Gabung video
            </PrimaryButton>
            <SecondaryButton
              onClick={() => {
                setFiles([]);
                setResult(null);
                setError("");
              }}
            >
              Kosongkan
            </SecondaryButton>
          </div>
          {files.length < 2 && <p className="mt-2 text-xs text-slate-500">Tambahkan minimal satu video lagi.</p>}
        </>
      )}
      {progress && <p className="mt-3 text-sm text-slate-500">{progress}</p>}
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
