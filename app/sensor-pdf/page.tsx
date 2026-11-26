"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput } from "@/components/ui";
import { loadPdfJsDoc, renderPageCanvas, downloadBlob, formatBytes, baseName } from "@/lib/pdf";

type Box = { x: number; y: number; w: number; h: number }; // px at VIEW scale
const VIEW = 1.5;
const EXPORT = 2.5;

export default function SensorPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [boxes, setBoxes] = useState<Record<number, Box[]>>({});
  const [draft, setDraft] = useState<Box | null>(null);
  const [term, setTerm] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    try {
      const d = await loadPdfJsDoc(await f.arrayBuffer());
      setFile(f);
      setDoc(d);
      setPageNum(1);
      setBoxes({});
    } catch {
      setError("PDF tidak bisa dibaca (mungkin terkunci password).");
    }
  };

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const c = await renderPageCanvas(doc, pageNum, VIEW);
      if (cancelled || !canvasRef.current) return;
      const t = canvasRef.current;
      t.width = c.width;
      t.height = c.height;
      t.getContext("2d")!.drawImage(c, 0, 0);
      setSize({ w: c.width, h: c.height });
    })();
    return () => { cancelled = true; };
  }, [doc, pageNum]);

  const pt = useCallback((e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = canvasRef.current!.width / r.width;
    return { x: Math.max(0, Math.min(size.w, (e.clientX - r.left) * sx)), y: Math.max(0, Math.min(size.h, (e.clientY - r.top) * sx)) };
  }, [size]);

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = pt(e);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = pt(e);
    setDraft({ x: Math.min(start.current.x, p.x), y: Math.min(start.current.y, p.y), w: Math.abs(p.x - start.current.x), h: Math.abs(p.y - start.current.y) });
  };
  const onUp = () => {
    start.current = null;
    if (draft && draft.w > 4 && draft.h > 4) setBoxes((b) => ({ ...b, [pageNum]: [...(b[pageNum] ?? []), draft] }));
    setDraft(null);
  };

  const findText = async () => {
    if (!doc || !term.trim()) return;
    setNote("");
    const needle = term.trim().toLowerCase();
    const added: Record<number, Box[]> = {};
    let n = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: VIEW });
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!("str" in it) || !it.str.toLowerCase().includes(needle)) continue;
        const [a, b2, c2, d2, e2, f2] = vp.transform;
        const ap = (x: number, y: number) => [a * x + c2 * y + e2, b2 * x + d2 * y + f2];
        const h = Math.abs(it.transform[3]) || 10;
        const [x1, y1] = ap(it.transform[4], it.transform[5] - h * 0.25);
        const [x2, y2] = ap(it.transform[4] + it.width, it.transform[5] + h);
        (added[p] ??= []).push({ x: Math.min(x1, x2) - 2, y: Math.min(y1, y2) - 2, w: Math.abs(x2 - x1) + 4, h: Math.abs(y2 - y1) + 4 });
        n++;
      }
    }
    if (n === 0) {
      setNote("Teks tidak ditemukan. Kalau PDF ini hasil scan, teksnya berupa gambar: sensor dengan menyeret kotak, atau jalankan OCR dulu.");
      return;
    }
    setBoxes((b) => {
      const out = { ...b };
      for (const [p, bs] of Object.entries(added)) out[+p] = [...(out[+p] ?? []), ...bs];
      return out;
    });
    setNote(`${n} lokasi ditandai. Seluruh baris teks yang memuat kata itu ikut ditutup, jadi cek kotaknya di tiap halaman.`);
  };

  const totalBoxes = Object.values(boxes).reduce((a, b) => a + b.length, 0);
  const pagesWithBoxes = Object.entries(boxes).filter(([, b]) => b.length > 0).map(([p]) => +p);

  const run = async () => {
    if (!file || !doc) return;
    setBusy(true);
    setError("");
    try {
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const out = await PDFDocument.create();
      for (let p = 1; p <= doc.numPages; p++) {
        const bs = boxes[p] ?? [];
        if (bs.length === 0) {
          const [cp] = await out.copyPages(src, [p - 1]);
          out.addPage(cp);
          continue;
        }
        const canvas = await renderPageCanvas(doc, p, EXPORT);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#000";
        const k = EXPORT / VIEW;
        for (const b of bs) ctx.fillRect(b.x * k, b.y * k, b.w * k, b.h * k);
        const bin = atob(canvas.toDataURL("image/jpeg", 0.9).split(",")[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const img = await out.embedJpg(bytes);
        const page = out.addPage([img.width / EXPORT, img.height / EXPORT]);
        page.drawImage(img, { x: 0, y: 0, width: img.width / EXPORT, height: img.height / EXPORT });
        canvas.width = 0;
      }
      const bytes = await out.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-sensor.pdf`,
        note: `${totalBoxes} area disensor di halaman ${pagesWithBoxes.join(", ")}. Halaman itu diubah jadi gambar, jadi teks di bawah kotak hitam benar-benar hilang. Halaman lain tidak diubah.`,
      });
    } catch {
      setError("Gagal membuat PDF tersensor.");
    } finally {
      setBusy(false);
    }
  };

  const cur = boxes[pageNum] ?? [];
  return (
    <ToolShell
      title="Sensor PDF"
      description="Tutup NIK, alamat, atau teks sensitif dengan kotak hitam yang permanen. Halaman yang disensor diubah jadi gambar, jadi teks di bawahnya benar-benar terhapus (beda dengan whiteout di Edit PDF yang hanya menutupi tampilan)."
    >
      {!file || !doc ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">{file.name} · {doc.numPages} halaman · {formatBytes(file.size)}</p>
          <div className="mb-3 grid max-w-xl gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <FieldLabel>Cari teks dan tandai otomatis (opsional)</FieldLabel>
              <TextInput value={term} onChange={(e) => setTerm(e.target.value)} placeholder="mis. nomor NIK atau nama" />
            </div>
            <SecondaryButton onClick={findText}>Tandai</SecondaryButton>
          </div>
          {note && <p className="mb-2 text-xs text-slate-600">{note}</p>}
          <p className="mb-2 text-xs text-slate-500">Seret di atas halaman untuk membuat kotak hitam. Kotak bisa dihapus lewat daftar di bawah.</p>
          <div className="mb-2 flex items-center gap-3 text-sm">
            <button className="rounded border border-line px-2 py-1 disabled:opacity-40" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>Sebelumnya</button>
            <span>Halaman {pageNum} / {doc.numPages}</span>
            <button className="rounded border border-line px-2 py-1 disabled:opacity-40" disabled={pageNum >= doc.numPages} onClick={() => setPageNum(pageNum + 1)}>Berikutnya</button>
          </div>
          <div className="relative inline-block max-w-full touch-none overflow-hidden rounded-lg border border-line">
            <canvas ref={canvasRef} className="block max-w-full cursor-crosshair" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
            {[...cur, ...(draft ? [draft] : [])].map((b, i) => (
              <div key={i} data-testid="redact-box" className="pointer-events-none absolute bg-black/85 ring-1 ring-red-500" style={{ left: `${(b.x / size.w) * 100}%`, top: `${(b.y / size.h) * 100}%`, width: `${(b.w / size.w) * 100}%`, height: `${(b.h / size.h) * 100}%` }} />
            ))}
          </div>
          {cur.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {cur.map((_, i) => (
                <button key={i} onClick={() => setBoxes((b) => ({ ...b, [pageNum]: b[pageNum].filter((_, j) => j !== i) }))} className="rounded border border-line px-2 py-1 text-slate-600">
                  Hapus kotak {i + 1}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Total {totalBoxes} kotak{pagesWithBoxes.length ? ` di halaman ${pagesWithBoxes.join(", ")}` : ""}. Info dokumen lain (judul, penulis) di halaman yang tidak disensor tidak diubah.</p>
          <div className="mt-3 flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy} disabled={totalBoxes === 0}>Sensor dan unduh</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setDoc(null); setBoxes({}); setResult(null); setError(""); setNote(""); }}>Ganti berkas</SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result && <ResultCard filename={result.name} sizeLabel={formatBytes(result.blob.size)} note={result.note} onDownload={() => downloadBlob(result.blob, result.name)} />}
    </ToolShell>
  );
}
