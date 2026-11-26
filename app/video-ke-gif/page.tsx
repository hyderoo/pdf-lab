"use client";

import { useEffect, useRef, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { getFfmpeg, setFfmpegProgress, toBlob } from "@/lib/ffmpeg";
import { parseTime, formatTime } from "@/lib/time";

const STICKER_MAX = 500 * 1024; // WhatsApp animated sticker limit
const STICKER_MAX_SEC = 10;
// Sticker attempts: webp quality, fps. Best first.
const STICKER_LADDER = [
  { q: 65, fps: 15 },
  { q: 50, fps: 12 },
  { q: 40, fps: 10 },
  { q: 30, fps: 10 },
  { q: 25, fps: 8 },
  { q: 15, fps: 8 },
];

export default function VideoKeGif() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [start, setStart] = useState("00:00.000");
  const [end, setEnd] = useState("");
  const [output, setOutput] = useState("stiker");
  const [fit, setFit] = useState("crop");
  const [pos, setPos] = useState(50);
  const [gifSize, setGifSize] = useState("480");
  const [gifFps, setGifFps] = useState("12");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note?: string; warn?: string; url: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  const onFile = (f: File) => {
    setError("");
    setResult(null);
    setFile(f);
    setDuration(0);
    setStart("00:00.000");
    setEnd("");
    setPos(50);
    setUrl(URL.createObjectURL(f));
  };
  const reset = () => { setFile(null); setUrl(""); setResult(null); setError(""); setProgress(""); };
  const setFromPlayer = (which: "start" | "end") => {
    const t = videoRef.current?.currentTime ?? 0;
    if (which === "start") setStart(formatTime(t)); else setEnd(formatTime(t));
  };

  const landscape = dims.w >= dims.h;
  const side = Math.min(dims.w, dims.h);
  const cropOn = fit === "crop" && dims.w > 0;
  // overlay (percent of the video box)
  const ov = cropOn
    ? landscape
      ? { left: ((dims.w - side) * pos) / 100 / dims.w * 100, top: 0, width: (side / dims.w) * 100, height: 100 }
      : { left: 0, top: ((dims.h - side) * pos) / 100 / dims.h * 100, width: 100, height: (side / dims.h) * 100 }
    : null;

  const run = async () => {
    if (!file) return;
    setError("");
    setResult(null);
    const s = parseTime(start);
    const e = end.trim() ? parseTime(end) : duration || null;
    if (s === null || e === null) { setError("Format waktu tidak valid. Contoh: 00:05.250 atau 5.25 (detik)."); return; }
    if (duration && (s >= duration || e > duration + 0.001)) { setError(`Waktu di luar durasi video (${formatTime(duration)}).`); return; }
    if (e <= s) { setError("Waktu akhir harus lebih besar dari waktu mulai."); return; }
    let len = e - s;
    const warns: string[] = [];
    if (output === "stiker" && len > STICKER_MAX_SEC) {
      len = STICKER_MAX_SEC;
      warns.push(`Stiker WhatsApp maksimal ${STICKER_MAX_SEC} detik, jadi hanya ${STICKER_MAX_SEC} detik pertama dari potongan yang dipakai.`);
    }
    if (output === "gif" && len > 15) warns.push("Potongan lebih dari 15 detik, ukuran GIF bisa sangat besar.");
    setBusy(true);
    try {
      const ff = await getFfmpeg(setProgress);
      setFfmpegProgress((p) => setProgress(`Mengonversi... ${Math.round(p * 100)}%`));
      const dot = file.name.lastIndexOf(".");
      const input = `input${dot >= 0 ? file.name.slice(dot) : ".mp4"}`;
      await ff.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      const x = Math.round(((dims.w - side) * pos) / 100 / 2) * 2;
      const y = Math.round(((dims.h - side) * pos) / 100 / 2) * 2;
      const cropF = cropOn && dims.w > 0 ? `crop=${side}:${side}:${landscape ? x : 0}:${landscape ? 0 : y},` : "";
      const base = ["-ss", s.toFixed(3), "-t", len.toFixed(3), "-i", input, "-an"];
      let blob: Blob;
      let name: string;
      let note: string;
      if (output === "gif") {
        const w = parseInt(gifSize, 10);
        const fps = parseInt(gifFps, 10);
        const vf = `${cropF}fps=${fps},scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
        const code = await ff.exec([...base, "-vf", vf, "-loop", "0", "out.gif"]);
        if (code !== 0) throw new Error("ffmpeg gagal membuat GIF dari video ini.");
        const data = await ff.readFile("out.gif");
        await ff.deleteFile("out.gif");
        blob = toBlob(data, "image/gif");
        name = `${baseName(file.name)}.gif`;
        note = `${formatTime(len)}, ${fps} fps, lebar ${w}px.`;
        if (blob.size > 10 * 1024 * 1024) warns.push("GIF lebih dari 10 MB. Kecilkan lebar, kurangi fps, atau pendekkan potongan.");
      } else {
        const pad = "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000";
        const sc = cropOn ? "scale=512:512:flags=lanczos" : pad;
        let out: Uint8Array | null = null;
        let used = STICKER_LADDER[0];
        let fitOk = false;
        for (let i = 0; i < STICKER_LADDER.length; i++) {
          const L = STICKER_LADDER[i];
          setProgress(`Membuat stiker (percobaan ${i + 1}/${STICKER_LADDER.length}, kualitas ${L.q})...`);
          const code = await ff.exec([
            ...base,
            "-vf", `${cropF}fps=${L.fps},${sc},format=yuva420p`,
            "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(L.q), "-compression_level", "4",
            "-loop", "0", "-an", "-vsync", "0", "out.webp",
          ]);
          if (code !== 0) throw new Error("ffmpeg gagal membuat stiker dari video ini.");
          out = await ff.readFile("out.webp");
          await ff.deleteFile("out.webp");
          used = L;
          if (out.length <= STICKER_MAX) { fitOk = true; break; }
        }
        if (!out) throw new Error("ffmpeg menghasilkan berkas kosong.");
        blob = toBlob(out, "image/webp");
        name = `${baseName(file.name)}-stiker.webp`;
        note = `512x512, ${formatTime(len)}, ${used.fps} fps, kualitas ${used.q}.`;
        if (!fitOk) warns.push(`Ukuran ${formatBytes(blob.size)} masih di atas batas 500 KB stiker WhatsApp. Pendekkan potongan lalu coba lagi.`);
        else if (used.q < 40) warns.push("Kualitas diturunkan supaya muat di 500 KB. Cek hasilnya.");
      }
      await ff.deleteFile(input);
      if (blob.size === 0) throw new Error("ffmpeg menghasilkan berkas kosong.");
      setResult({ blob, name, note, warn: warns.join(" "), url: URL.createObjectURL(blob) });
      setProgress("");
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("ffmpeg")
          ? err.message
          : "Gagal memproses. Video terlalu besar untuk memori browser, atau formatnya tidak didukung. Coba potongan atau video yang lebih kecil."
      );
      setProgress("");
    } finally {
      setFfmpegProgress(null);
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Video ke GIF / Stiker"
      description="Pilih potongan video, crop kotak, lalu ekspor sebagai GIF atau stiker WhatsApp animasi (WebP 512x512, maksimal 500 KB dan 10 detik). Video tidak pernah diunggah."
    >
      {!file && (
        <FileDrop accept="video/*" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu video" hint="MP4, WebM, MOV. Disarankan video pendek." />
      )}
      {file && (
        <>
          <p className="text-sm text-slate-600">
            {file.name} - {formatBytes(file.size)}
            {duration > 0 ? ` - durasi ${formatTime(duration)}` : ""}
            {dims.w > 0 ? ` - ${dims.w}x${dims.h}` : ""}
          </p>
          <div className="relative inline-block max-w-full self-start">
            <video
              ref={videoRef}
              src={url}
              controls
              muted
              onLoadedMetadata={(ev) => {
                const v = ev.currentTarget;
                setDims({ w: v.videoWidth, h: v.videoHeight });
                if (isFinite(v.duration)) { setDuration(v.duration); setEnd((cur) => cur || formatTime(v.duration)); }
              }}
              className="block max-h-80 max-w-full rounded-lg bg-black"
            />
            {ov && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg" data-testid="crop-overlay">
                <div
                  className="absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                  style={{ left: `${ov.left}%`, top: `${ov.top}%`, width: `${ov.width}%`, height: `${ov.height}%` }}
                />
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Mulai (mm:ss.mmm)</FieldLabel>
              <TextInput value={start} onChange={(e) => setStart(e.target.value)} placeholder="00:05.250" inputMode="decimal" />
              <button type="button" onClick={() => setFromPlayer("start")} className="mt-1 text-xs text-blue-700 underline">Pakai posisi video sekarang</button>
            </div>
            <div>
              <FieldLabel>Akhir (mm:ss.mmm)</FieldLabel>
              <TextInput value={end} onChange={(e) => setEnd(e.target.value)} placeholder="00:12.800" inputMode="decimal" />
              <button type="button" onClick={() => setFromPlayer("end")} className="mt-1 text-xs text-blue-700 underline">Pakai posisi video sekarang</button>
            </div>
            <div>
              <FieldLabel>Hasil</FieldLabel>
              <Select value={output} onChange={(e) => setOutput(e.target.value)}>
                <option value="stiker">Stiker WhatsApp (WebP animasi 512x512)</option>
                <option value="gif">GIF</option>
              </Select>
            </div>
            <div>
              <FieldLabel>Bingkai</FieldLabel>
              <Select value={fit} onChange={(e) => setFit(e.target.value)}>
                <option value="crop">Crop kotak (potong sisi)</option>
                <option value="full">Tetap utuh{output === "stiker" ? " (ruang kosong transparan)" : ""}</option>
              </Select>
            </div>
            {cropOn && (
              <div className="sm:col-span-2">
                <FieldLabel>Posisi crop ({landscape ? "kiri ke kanan" : "atas ke bawah"})</FieldLabel>
                <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(parseInt(e.target.value, 10))} className="w-full" aria-label="Posisi crop" />
              </div>
            )}
            {output === "gif" && (
              <>
                <div>
                  <FieldLabel>Lebar GIF</FieldLabel>
                  <Select value={gifSize} onChange={(e) => setGifSize(e.target.value)}>
                    <option value="320">320 px (kecil)</option>
                    <option value="480">480 px</option>
                    <option value="640">640 px</option>
                  </Select>
                </div>
                <div>
                  <FieldLabel>Frame per detik</FieldLabel>
                  <Select value={gifFps} onChange={(e) => setGifFps(e.target.value)}>
                    <option value="8">8 fps (kecil)</option>
                    <option value="12">12 fps</option>
                    <option value="15">15 fps (halus)</option>
                  </Select>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton onClick={run} busy={busy}>{output === "stiker" ? "Buat stiker" : "Buat GIF"}</PrimaryButton>
            <SecondaryButton onClick={reset}>Ganti berkas</SecondaryButton>
          </div>
        </>
      )}
      {progress && <p className="text-sm text-slate-500">{progress}</p>}
      <ErrorNote>{error}</ErrorNote>
      {result?.warn && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{result.warn}</p>
      )}
      {result && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.url} alt="Hasil" className="mt-4 h-48 w-48 rounded-lg border border-line bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px] object-contain" />
          <ResultCard filename={result.name} sizeLabel={formatBytes(result.blob.size)} note={result.note} onDownload={() => downloadBlob(result.blob, result.name)} />
        </>
      )}
    </ToolShell>
  );
}
