"use client";

import { useState } from "react";
import JSZip from "jszip";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select, TextInput } from "@/components/ui";
import { loadPdfJsDoc, downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { loadBitmap, compressPhoto, compressPdfToTarget } from "@/lib/compress";

type Row = { name: string; status: "ok" | "warn" | "fail"; text: string };

export default function BatchKompres() {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState("foto");
  const [targetVal, setTargetVal] = useState("200");
  const [targetUnit, setTargetUnit] = useState("KB");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [zip, setZip] = useState<Blob | null>(null);

  const onFiles = (fs: File[]) => {
    setError("");
    setZip(null);
    setRows([]);
    const isPdf = (f: File) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const pdfs = fs.filter(isPdf);
    const imgs = fs.filter((f) => !isPdf(f));
    if (pdfs.length && imgs.length) setError("Pilih semua foto atau semua PDF, jangan dicampur. Berkas yang bukan jenis pertama diabaikan.");
    const useP = pdfs.length > 0 && pdfs.length >= imgs.length;
    setKind(useP ? "pdf" : "foto");
    setFiles(useP ? pdfs : imgs);
  };

  const run = async () => {
    const v = parseFloat(targetVal.replace(",", "."));
    if (!isFinite(v) || v <= 0) { setError("Isi ukuran maksimal dengan angka lebih dari 0."); return; }
    const target = Math.round(v * (targetUnit === "MB" ? 1e6 : 1000));
    setBusy(true);
    setError("");
    setZip(null);
    const out: Row[] = [];
    const z = new JSZip();
    const used = new Set<string>();
    const uniq = (n: string) => { let x = n, i = 2; while (used.has(x)) { x = n.replace(/(\.[^.]+)$/, `-${i++}$1`); } used.add(x); return x; };
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setProgress(`Memproses ${i + 1} dari ${files.length}: ${f.name}`);
        try {
          if (kind === "pdf") {
            const doc = await loadPdfJsDoc(await f.arrayBuffer());
            if (f.size <= target) { z.file(uniq(f.name), f); out.push({ name: f.name, status: "ok", text: `${formatBytes(f.size)}, sudah di bawah target (tidak diubah)` }); continue; }
            const r = await compressPdfToTarget(doc, target);
            z.file(uniq(`${baseName(f.name)}-kompres.pdf`), r.bytes);
            out.push({ name: f.name, status: r.fit && !r.low ? "ok" : "warn", text: `${formatBytes(f.size)} → ${formatBytes(r.bytes.length)}${!r.fit ? ", target tidak tercapai" : r.low ? ", kualitas turun jauh, cek keterbacaan" : ""}` });
          } else {
            const bmp = await loadBitmap(f);
            const r = await compressPhoto(bmp, target, "image/jpeg");
            if (!r) { out.push({ name: f.name, status: "fail", text: "target tidak tercapai" }); continue; }
            z.file(uniq(`${baseName(f.name)}-kompres.jpg`), r.blob);
            const warn = r.shrink < 0.6 || r.q < 0.5;
            out.push({ name: f.name, status: warn ? "warn" : "ok", text: `${formatBytes(f.size)} → ${formatBytes(r.blob.size)}, ${r.w}x${r.h}px${warn ? ", kualitas/resolusi turun jauh, cek hasilnya" : ""}` });
          }
        } catch {
          out.push({ name: f.name, status: "fail", text: "gagal dibaca atau diproses" });
        }
        setRows([...out]);
      }
      setRows(out);
      if (out.some((r) => r.status !== "fail")) setZip(await z.generateAsync({ type: "blob" }));
      else setError("Tidak ada berkas yang berhasil diproses.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <ToolShell
      title="Kompres Massal"
      description="Kompres banyak foto atau banyak PDF sekaligus ke ukuran target, hasilnya satu berkas ZIP. Semua diproses di browser."
    >
      {files.length === 0 ? (
        <FileDrop accept="image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf" multiple onFiles={onFiles} label="Pilih banyak foto atau banyak PDF" hint="Satu jenis saja per proses: semua foto, atau semua PDF." />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">{files.length} {kind === "pdf" ? "PDF" : "foto"} · {formatBytes(files.reduce((a, f) => a + f.size, 0))}</p>
          <div className="mb-4 grid max-w-md gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Ukuran maksimal per berkas</FieldLabel>
              <TextInput value={targetVal} onChange={(e) => setTargetVal(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <FieldLabel>Satuan</FieldLabel>
              <Select value={targetUnit} onChange={(e) => setTargetUnit(e.target.value)}>
                <option value="KB">KB</option>
                <option value="MB">MB</option>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Kompres semua</PrimaryButton>
            <SecondaryButton onClick={() => { setFiles([]); setRows([]); setZip(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
          {progress && <p className="mt-3 text-xs text-slate-500">{progress}</p>}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {rows.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {rows.map((r, i) => (
            <li key={i} className={r.status === "ok" ? "text-slate-700" : r.status === "warn" ? "text-amber-700" : "text-rose-700"}>
              {r.status === "ok" ? "OK" : r.status === "warn" ? "Cek" : "Gagal"} · {r.name}: {r.text}
            </li>
          ))}
        </ul>
      )}
      {zip && <ResultCard filename="kompres-massal.zip" sizeLabel={formatBytes(zip.size)} note={`${rows.filter((r) => r.status !== "fail").length} dari ${rows.length} berkas masuk ZIP.`} onDownload={() => downloadBlob(zip, "kompres-massal.zip")} />}
    </ToolShell>
  );
}
