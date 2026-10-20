"use client";

import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote } from "@/components/ui";
import { loadPdfJsDoc, renderPageThumb, downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { ArrowLeft, ArrowRight, Copy, Trash2, FilePlus2 } from "lucide-react";

type Entry = { id: number; src: number | null }; // src = original page index, null = blank
let nextId = 1;

export default function AturHalamanPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [jsDoc, setJsDoc] = useState<PDFDocumentProxy | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    try {
      const buf = await f.arrayBuffer();
      const doc = await loadPdfJsDoc(buf.slice(0));
      setFile(f);
      setJsDoc(doc);
      setEntries([...Array(doc.numPages)].map((_, i) => ({ id: nextId++, src: i })));
      setThumbs({});
    } catch {
      setError("PDF tidak bisa dibaca.");
    }
  };

  useEffect(() => {
    if (!jsDoc) return;
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= jsDoc.numPages; i++) {
        if (cancelled) return;
        const url = await renderPageThumb(jsDoc, i, 140);
        if (cancelled) return;
        setThumbs((prev) => ({ ...prev, [i - 1]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jsDoc]);

  const move = (i: number, dir: -1 | 1) =>
    setEntries((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const blankSize = src.getPage(0).getSize();
      const copied = await out.copyPages(src, src.getPageIndices());
      for (const e of entries) {
        if (e.src === null) {
          out.addPage([blankSize.width, blankSize.height]);
        } else {
          out.addPage(copied[e.src]);
        }
      }
      const bytes = await out.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-diatur.pdf`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyusun PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Atur Halaman PDF"
      description="Susun ulang, hapus, gandakan, atau sisipkan halaman kosong lewat thumbnail halaman."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF untuk diatur" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {file.name} · {entries.length} halaman · {formatBytes(file.size)}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {entries.map((e, i) => (
              <div key={e.id} className="rounded-lg border border-line bg-panel p-2">
                <div className="flex h-36 items-center justify-center overflow-hidden rounded bg-panel2">
                  {e.src === null ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Kosong
                    </span>
                  ) : thumbs[e.src] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[e.src]} alt={`Halaman ${e.src + 1}`} className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-600">…</span>
                  )}
                </div>
                <p className="mt-1.5 text-center text-[11px] font-semibold text-slate-600">
                  {i + 1}
                  {e.src !== null && e.src !== i && (
                    <span className="ml-1 font-normal text-slate-500">(asl: {e.src + 1})</span>
                  )}
                </p>
                <div className="mt-1 flex justify-center gap-0.5">
                  <button onClick={() => move(i, -1)} title="Geser kiri" className="rounded p-1 text-slate-500 hover:bg-panel2">
                    <ArrowLeft size={13} />
                  </button>
                  <button onClick={() => move(i, 1)} title="Geser kanan" className="rounded p-1 text-slate-500 hover:bg-panel2">
                    <ArrowRight size={13} />
                  </button>
                  <button
                    onClick={() => setEntries((prev) => [...prev.slice(0, i + 1), { id: nextId++, src: e.src }, ...prev.slice(i + 1)])}
                    title="Gandakan"
                    className="rounded p-1 text-slate-500 hover:bg-panel2"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    onClick={() => setEntries((prev) => [...prev.slice(0, i + 1), { id: nextId++, src: null }, ...prev.slice(i + 1)])}
                    title="Sisipkan halaman kosong"
                    className="rounded p-1 text-slate-500 hover:bg-panel2"
                  >
                    <FilePlus2 size={13} />
                  </button>
                  <button
                    onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                    title="Hapus"
                    className="rounded p-1 text-slate-500 hover:bg-panel2 hover:text-rose-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy} disabled={entries.length === 0}>
              Simpan susunan baru
            </PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setJsDoc(null); setEntries([]); setResult(null); setError(""); }}>
              Ganti berkas
            </SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <ResultCard
          filename={result.name}
          sizeLabel={formatBytes(result.blob.size)}
          onDownload={() => downloadBlob(result.blob, result.name)}
        />
      )}
    </ToolShell>
  );
}
