"use client";

import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { ArrowUp, ArrowDown, X, FileText } from "lucide-react";

export default function GabungPdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const move = (i: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const merge = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await PDFDocument.create();
      for (const f of files) {
        const src = await PDFDocument.load(await f.arrayBuffer(), {
          ignoreEncryption: true,
        });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      const name = `${baseName(files[0].name)}-gabungan.pdf`;
      setResult({ blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menggabungkan PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Gabung PDF"
      description="Gabungkan beberapa berkas PDF menjadi satu dokumen sesuai urutan yang kamu tentukan."
    >
      <FileDrop
        accept="application/pdf"
        multiple
        onFiles={(fs) => {
          setFiles((prev) => [...prev, ...fs.filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"))]);
          setResult(null);
        }}
        label="Tarik & letakkan PDF di sini, atau klik untuk memilih"
        hint="Bisa pilih banyak PDF sekaligus"
      />

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2"
            >
              <FileText size={16} className="shrink-0 text-accent" />
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
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="rounded p-1 text-slate-500 hover:bg-panel2 hover:text-rose-600"
                title="Hapus"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={merge} disabled={files.length < 2} busy={busy}>
          Gabungkan {files.length >= 2 ? `${files.length} PDF` : ""}
        </PrimaryButton>
        {files.length > 0 && (
          <SecondaryButton onClick={() => { setFiles([]); setResult(null); setError(""); }}>
            Ulang dari awal
          </SecondaryButton>
        )}
      </div>
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
