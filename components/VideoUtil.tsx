"use client";

import { useEffect, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { getFfmpeg, setFfmpegProgress, toBlob } from "@/lib/ffmpeg";
import { formatTime } from "@/lib/time";

export type VideoUtilMode = "ekstrak-audio" | "mute-video" | "konversi-video";

const COPY: Record<VideoUtilMode, { title: string; description: string; button: string }> = {
  "ekstrak-audio": {
    title: "Ekstrak Audio",
    description: "Ambil suara dari video dan simpan sebagai MP3, M4A, atau WAV, langsung di browser. Video tidak pernah diunggah.",
    button: "Ekstrak audio",
  },
  "mute-video": {
    title: "Mute Video",
    description: "Hapus suara dari video tanpa encode ulang gambar, jadi cepat dan kualitas gambar tetap sama. Video tidak pernah diunggah.",
    button: "Hapus suara",
  },
  "konversi-video": {
    title: "Konversi ke MP4",
    description: "Ubah video MOV, WebM, MKV, atau AVI menjadi MP4 (H.264/AAC) yang bisa diputar di mana saja. Video tidak pernah diunggah.",
    button: "Konversi ke MP4",
  },
};

export default function VideoUtil({ mode }: { mode: VideoUtilMode }) {
  const copy = COPY[mode];
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState("");
  const [audioFmt, setAudioFmt] = useState("mp3");
  const [bitrate, setBitrate] = useState("192");
  const [crf, setCrf] = useState("23");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note?: string; url: string; isAudio: boolean; isVideo: boolean } | null>(null);

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  const onFile = (f: File) => {
    setError("");
    setResult(null);
    setFile(f);
    setInfo("");
    const u = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (isFinite(v.duration)) setInfo(`durasi ${formatTime(v.duration)}${v.videoWidth ? ` - ${v.videoWidth}x${v.videoHeight}` : ""}`);
      URL.revokeObjectURL(u);
    };
    v.onerror = () => URL.revokeObjectURL(u);
    v.src = u;
  };
  const reset = () => { setFile(null); setResult(null); setError(""); setProgress(""); };

  const run = async () => {
    if (!file) return;
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const ff = await getFfmpeg(setProgress);
      setFfmpegProgress((p) => setProgress(`Memproses... ${Math.round(p * 100)}%`));
      const dot = file.name.lastIndexOf(".");
      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ".mp4";
      const input = `input${ext}`;
      await ff.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      setProgress("Memproses...");
      let args: string[];
      let outName: string;
      let mime: string;
      let suffix: string;
      if (mode === "ekstrak-audio") {
        if (audioFmt === "mp3") { outName = "out.mp3"; mime = "audio/mpeg"; args = ["-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", `${bitrate}k`, outName]; }
        else if (audioFmt === "m4a") { outName = "out.m4a"; mime = "audio/mp4"; args = ["-i", input, "-vn", "-c:a", "aac", "-b:a", `${bitrate}k`, outName]; }
        else { outName = "out.wav"; mime = "audio/wav"; args = ["-i", input, "-vn", "-c:a", "pcm_s16le", outName]; }
        suffix = `.${audioFmt}`;
      } else if (mode === "mute-video") {
        const keep = [".mp4", ".mov", ".m4v", ".webm", ".mkv"].includes(ext) ? ext : ".mp4";
        outName = `out${keep}`;
        mime = keep === ".webm" ? "video/webm" : keep === ".mkv" ? "video/x-matroska" : keep === ".mov" ? "video/quicktime" : "video/mp4";
        args = ["-i", input, "-an", "-c:v", "copy", outName];
        suffix = `-mute${keep}`;
      } else {
        outName = "out.mp4";
        mime = "video/mp4";
        args = ["-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outName];
        suffix = ".mp4";
      }
      const code = await ff.exec(args);
      if (code !== 0) {
        if (mode === "ekstrak-audio") throw new Error("ffmpeg gagal. Video ini mungkin tidak punya suara.");
        throw new Error("ffmpeg gagal memproses video ini.");
      }
      const data = await ff.readFile(outName);
      await ff.deleteFile(input);
      await ff.deleteFile(outName);
      if (data.length === 0) throw new Error("ffmpeg menghasilkan berkas kosong.");
      const blob = toBlob(data, mime);
      setResult({
        blob,
        name: `${baseName(file.name)}${suffix}`,
        url: URL.createObjectURL(blob),
        isAudio: mode === "ekstrak-audio",
        isVideo: mode !== "ekstrak-audio",
        note: `${formatBytes(file.size)} → ${formatBytes(blob.size)}`,
      });
      setProgress("");
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("ffmpeg")
          ? err.message
          : "Gagal memproses. Video terlalu besar untuk memori browser, atau formatnya tidak didukung. Coba video yang lebih kecil."
      );
      setProgress("");
    } finally {
      setFfmpegProgress(null);
      setBusy(false);
    }
  };

  return (
    <ToolShell title={copy.title} description={copy.description}>
      {!file && (
        <FileDrop accept="video/*,.mkv,.avi,.mov" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu video" hint="MP4, MOV, WebM, MKV, AVI. Diproses di browser kamu." />
      )}
      {file && (
        <>
          <p className="text-sm text-slate-600">{file.name} - {formatBytes(file.size)}{info ? ` - ${info}` : ""}</p>
          {mode === "ekstrak-audio" && (
            <div className="grid max-w-xl gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>Format</FieldLabel>
                <Select value={audioFmt} onChange={(e) => setAudioFmt(e.target.value)}>
                  <option value="mp3">MP3 (paling umum)</option>
                  <option value="m4a">M4A (AAC)</option>
                  <option value="wav">WAV (tanpa kompresi, besar)</option>
                </Select>
              </div>
              {audioFmt !== "wav" && (
                <div>
                  <FieldLabel>Kualitas</FieldLabel>
                  <Select value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
                    <option value="128">128 kbps (kecil)</option>
                    <option value="192">192 kbps</option>
                    <option value="256">256 kbps</option>
                    <option value="320">320 kbps (terbaik)</option>
                  </Select>
                </div>
              )}
            </div>
          )}
          {mode === "konversi-video" && (
            <div className="max-w-xs">
              <FieldLabel>Kualitas</FieldLabel>
              <Select value={crf} onChange={(e) => setCrf(e.target.value)}>
                <option value="20">Tinggi (berkas lebih besar)</option>
                <option value="23">Seimbang</option>
                <option value="28">Kecil (kualitas turun)</option>
              </Select>
            </div>
          )}
          {mode === "mute-video" && (
            <p className="text-xs text-slate-500">Gambar tidak di-encode ulang, jadi kualitas sama persis dan prosesnya cepat. Format asli dipertahankan.</p>
          )}
          <div className="flex flex-wrap gap-3">
            <PrimaryButton onClick={run} busy={busy}>{copy.button}</PrimaryButton>
            <SecondaryButton onClick={reset}>Ganti berkas</SecondaryButton>
          </div>
        </>
      )}
      {progress && <p className="text-sm text-slate-500">{progress}</p>}
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <>
          {result.isAudio && <audio src={result.url} controls className="mt-4 w-full max-w-md" />}
          {result.isVideo && <video src={result.url} controls muted={mode === "mute-video"} className="mt-4 max-h-64 rounded-lg bg-black" />}
          <ResultCard filename={result.name} sizeLabel={formatBytes(result.blob.size)} note={result.note} onDownload={() => downloadBlob(result.blob, result.name)} />
        </>
      )}
    </ToolShell>
  );
}
