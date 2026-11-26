"use client";

import { useState } from "react";
import JSZip from "jszip";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote } from "@/components/ui";
import { loadPdfJsDoc, extractAllText, downloadBlob, formatBytes, baseName } from "@/lib/pdf";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// remove characters XML 1.0 forbids
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");

function buildDocx(pages: string[]): Promise<Blob> {
  const paras: string[] = [];
  pages.forEach((page, pi) => {
    const lines = page.split("\n");
    lines.forEach((line, li) => {
      const t = clean(line).trim();
      if (!t) return;
      const bullet = /^[-*]\s+/.test(t);
      const body = bullet ? t.replace(/^[-*]\s+/, "") : t;
      const br = pi > 0 && li === lines.findIndex((l) => l.trim()) ? '<w:r><w:br w:type="page"/></w:r>' : "";
      const ppr = bullet ? '<w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>' : '<w:pPr><w:spacing w:after="120"/></w:pPr>';
      paras.push(`<w:p>${ppr}${br}<w:r><w:t xml:space="preserve">${bullet ? "\u2022 " : ""}${esc(body)}</w:t></w:r></w:p>`);
    });
  });
  if (paras.length === 0) paras.push("<w:p/>");
  const doc =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file("word/document.xml", doc);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export default function PdfKeWord() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note: string; warn?: string } | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const doc = await loadPdfJsDoc(await file.arrayBuffer());
      const pages = await extractAllText(doc);
      const chars = pages.join("").replace(/\s/g, "").length;
      const blob = await buildDocx(pages);
      setResult({
        blob,
        name: `${baseName(file.name)}.docx`,
        note: `${doc.numPages} halaman, ${chars} karakter teks. Hasil berupa teks per paragraf, tanpa tabel, kolom, gambar, dan font asli.`,
        warn:
          chars < 20 * doc.numPages
            ? "Hampir tidak ada teks di PDF ini, kemungkinan hasil scan. Jalankan OCR PDF dulu, lalu ubah hasilnya ke Word."
            : undefined,
      });
    } catch {
      setError("PDF tidak bisa dibaca atau diubah.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="PDF ke Word"
      description="Ubah teks PDF menjadi dokumen Word (.docx) yang bisa diedit. Hasilnya aproksimasi: teks per paragraf, tanpa tabel, kolom, atau gambar. PDF hasil scan perlu OCR dulu."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && setFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">{file.name} · {formatBytes(file.size)}</p>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>Ubah ke Word</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result?.warn && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{result.warn}</p>}
      {result && <ResultCard filename={result.name} sizeLabel={formatBytes(result.blob.size)} note={result.note} onDownload={() => downloadBlob(result.blob, result.name)} />}
    </ToolShell>
  );
}
