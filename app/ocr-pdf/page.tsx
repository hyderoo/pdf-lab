"use client";

import { useRef, useState } from "react";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, Select } from "@/components/ui";
import { loadPdfJsDoc, renderPageCanvas, downloadBlob, formatBytes, baseName } from "@/lib/pdf";

type Word = { text: string; conf: number; x0: number; y0: number; x1: number; y1: number };
type OcrWorker = {
  recognize: (img: HTMLCanvasElement, opts: object, out: object) => Promise<{
    data: { text: string; confidence: number; blocks: { paragraphs: { lines: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] | null };
  }>;
  terminate: () => Promise<unknown>;
};

const RENDER_SCALE = 2.2; // about 160 dpi, good balance of accuracy and speed
const MAX_PAGES_SOFT = 30;

function toWinAnsi(font: PDFFont, s: string): string {
  let out = "";
  for (const ch of s) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      /* skip characters Helvetica cannot encode */
    }
  }
  return out;
}

export default function OcrPdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [isPdf, setIsPdf] = useState(true);
  const [lang, setLang] = useState("ind+eng");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ pdf: Blob; txt: Blob; name: string; text: string; conf: number; pages: number; words: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const workerRef = useRef<OcrWorker | null>(null);
  const workerLang = useRef("");

  const onFiles = (fs: File[]) => {
    setError("");
    setResult(null);
    const pdf = fs.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (pdf) { setFiles([pdf]); setIsPdf(true); return; }
    const imgs = fs.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) { setError("Pilih PDF atau gambar (JPG, PNG)."); return; }
    setFiles(imgs);
    setIsPdf(false);
  };

  const getWorker = async (): Promise<OcrWorker> => {
    if (workerRef.current && workerLang.current === lang) return workerRef.current;
    if (workerRef.current) { await workerRef.current.terminate(); workerRef.current = null; }
    const { createWorker } = await import("tesseract.js");
    setProgress("Memuat mesin OCR (sekali saja, beberapa MB)...");
    const w = (await createWorker(lang.split("+"), 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      gzip: false,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") setProgress((p) => p.replace(/\s*\d+%$/, "") + ` ${Math.round(m.progress * 100)}%`);
      },
    })) as unknown as OcrWorker;
    workerRef.current = w;
    workerLang.current = lang;
    return w;
  };

  const run = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      const worker = await getWorker();
      const out = isPdf ? await PDFDocument.load(await files[0].arrayBuffer(), { ignoreEncryption: true }) : await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);
      const pdfjsDoc = isPdf ? await loadPdfJsDoc(await files[0].arrayBuffer()) : null;
      const total = isPdf ? pdfjsDoc!.numPages : files.length;
      const texts: string[] = [];
      let confSum = 0;
      let confN = 0;
      let wordCount = 0;
      for (let i = 0; i < total; i++) {
        setProgress(`Membaca halaman ${i + 1} dari ${total}... 0%`);
        let canvas: HTMLCanvasElement;
        if (isPdf) {
          canvas = await renderPageCanvas(pdfjsDoc!, i + 1, RENDER_SCALE);
        } else {
          const bmp = await createImageBitmap(files[i]);
          const k = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
          canvas = document.createElement("canvas");
          canvas.width = Math.round(bmp.width * k);
          canvas.height = Math.round(bmp.height * k);
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        }
        const res = await worker.recognize(canvas, {}, { text: true, blocks: true });
        const words: Word[] = [];
        for (const b of res.data.blocks ?? [])
          for (const p of b.paragraphs)
            for (const l of p.lines)
              for (const w of l.words)
                if (w.text.trim()) words.push({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
        texts.push(res.data.text.trim());
        for (const w of words) { confSum += w.conf; confN++; }
        wordCount += words.length;

        let page;
        let sx: number;
        let sy: number;
        if (isPdf) {
          page = out.getPage(i);
          const { width, height } = page.getSize();
          sx = width / canvas.width;
          sy = height / canvas.height;
        } else {
          const bytes = new Uint8Array(await files[i].arrayBuffer());
          const isPng = files[i].type === "image/png";
          let img;
          try {
            img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
          } catch {
            const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.9));
            img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          }
          const w = img.width;
          const h = img.height;
          page = out.addPage([w, h]);
          page.drawImage(img, { x: 0, y: 0, width: w, height: h });
          sx = w / canvas.width;
          sy = h / canvas.height;
        }
        const { height: ph } = page.getSize();
        for (const w of words) {
          const txt = toWinAnsi(font, w.text);
          if (!txt) continue;
          const width = (w.x1 - w.x0) * sx;
          const natural = font.widthOfTextAtSize(txt, 1);
          if (natural <= 0 || width <= 0) continue;
          const size = Math.min(Math.max(width / natural, 1), (w.y1 - w.y0) * sy * 1.6);
          page.drawText(txt, { x: w.x0 * sx, y: ph - w.y1 * sy, size, font, opacity: 0 });
        }
        canvas.width = 0;
      }
      const pdfBytes = await out.save();
      const text = texts.map((t, i) => (total > 1 ? `--- Halaman ${i + 1} ---\n${t}` : t)).join("\n\n");
      const conf = confN ? confSum / confN : 0;
      setResult({
        pdf: new Blob([pdfBytes as BlobPart], { type: "application/pdf" }),
        txt: new Blob([text], { type: "text/plain;charset=utf-8" }),
        name: `${baseName(files[0].name)}-ocr`,
        text,
        conf,
        pages: total,
        words: wordCount,
      });
    } catch (e) {
      setError(e instanceof Error && e.message ? `Gagal menjalankan OCR: ${e.message}` : "Gagal menjalankan OCR.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const reset = () => { setFiles([]); setResult(null); setError(""); setCopied(false); };
  const totalSize = files.reduce((a, f) => a + f.size, 0);

  return (
    <ToolShell
      title="OCR PDF"
      description="Ubah PDF scan atau foto dokumen menjadi PDF yang teksnya bisa dicari dan disalin, plus berkas teks. Mendukung bahasa Indonesia dan Inggris. Semua diproses di browser."
    >
      {files.length === 0 ? (
        <FileDrop
          accept="application/pdf,image/jpeg,image/png"
          multiple
          onFiles={onFiles}
          label="Pilih PDF scan atau foto dokumen"
          hint="Satu PDF, atau beberapa foto JPG/PNG (satu foto jadi satu halaman)."
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {isPdf ? files[0].name : `${files.length} foto`} · {formatBytes(totalSize)}
          </p>
          <div className="mb-4 max-w-xs">
            <FieldLabel>Bahasa dokumen</FieldLabel>
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="ind+eng">Indonesia + Inggris</option>
              <option value="ind">Indonesia</option>
              <option value="eng">Inggris</option>
            </Select>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            OCR cukup lambat untuk dokumen tebal (sekitar beberapa detik per halaman){isPdf ? "" : ""}. Hasil perlu dicek, terutama untuk scan buram atau tulisan tangan.
          </p>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Jalankan OCR</PrimaryButton>
            <SecondaryButton onClick={reset}>Ganti berkas</SecondaryButton>
          </div>
          {progress && <p className="mt-3 text-xs text-slate-500">{progress}</p>}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <>
          {result.pages > MAX_PAGES_SOFT && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Dokumen panjang ({result.pages} halaman). Periksa hasilnya dengan teliti.
            </p>
          )}
          {result.words === 0 ? (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Tidak ada teks yang terbaca. Coba scan yang lebih jelas atau pilih bahasa lain.
            </p>
          ) : result.conf < 75 ? (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Tingkat keyakinan OCR hanya sekitar {Math.round(result.conf)}%. Hasil kemungkinan banyak salah baca, cek dulu sebelum dipakai.
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Keyakinan OCR rata-rata sekitar {Math.round(result.conf)}% ({result.words} kata, {result.pages} halaman). Tetap cek bagian penting.</p>
          )}
          <ResultCard
            filename={`${result.name}.pdf`}
            sizeLabel={formatBytes(result.pdf.size)}
            note="PDF dengan teks yang bisa dicari dan disalin (lapisan teks tak terlihat di atas gambar asli)."
            onDownload={() => downloadBlob(result.pdf, `${result.name}.pdf`)}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button onClick={() => downloadBlob(result.txt, `${result.name}.txt`)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-panel2">
              Unduh teks (.txt)
            </button>
            <button
              onClick={async () => { await navigator.clipboard.writeText(result.text); setCopied(true); }}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-panel2"
            >
              {copied ? "Tersalin" : "Salin teks"}
            </button>
          </div>
          <textarea readOnly value={result.text} rows={12} className="mt-3 w-full rounded-lg border border-line bg-panel2 p-3 font-mono text-xs text-slate-700" aria-label="Hasil teks OCR" />
        </>
      )}
    </ToolShell>
  );
}
