"use client";

// Shared loader for the vendored ffmpeg.wasm (same-origin only, CSP-safe).
const FFMPEG_JS = "/ffmpeg/ffmpeg.js";
const CORE_JS = "/ffmpeg/core/ffmpeg-core.js";
const CORE_WASM = "/ffmpeg/core/ffmpeg-core.wasm";

export type FFmpegLike = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<boolean>;
  on: (event: "progress" | "log", cb: (p: { progress: number; message?: string }) => void) => void;
  off?: (event: "progress" | "log", cb: (p: { progress: number; message?: string }) => void) => void;
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array>;
  deleteFile: (path: string) => Promise<boolean>;
  exec: (args: string[]) => Promise<number>;
};

type FFmpegWindow = { FFmpegWASM?: { FFmpeg: new () => FFmpegLike } };

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("script"));
    document.head.appendChild(el);
  });
}

let instance: FFmpegLike | null = null;
let progressCb: ((p: number) => void) | null = null;

export function setFfmpegProgress(cb: ((p: number) => void) | null) {
  progressCb = cb;
}

export async function getFfmpeg(onStatus?: (s: string) => void): Promise<FFmpegLike> {
  if (instance) return instance;
  const w = window as unknown as FFmpegWindow;
  if (!w.FFmpegWASM) await loadScript(FFMPEG_JS);
  const Ctor = w.FFmpegWASM?.FFmpeg;
  if (!Ctor) throw new Error("ffmpeg gagal dimuat.");
  const ff = new Ctor();
  ff.on("progress", ({ progress }) => {
    if (progress > 0 && progress <= 1) progressCb?.(progress);
  });
  onStatus?.("Memuat mesin video (sekali saja, ~30 MB)...");
  await ff.load({ coreURL: CORE_JS, wasmURL: CORE_WASM });
  instance = ff;
  return ff;
}

export function toBlob(data: Uint8Array, type: string): Blob {
  return new Blob([new Uint8Array(data).buffer as ArrayBuffer], { type });
}
