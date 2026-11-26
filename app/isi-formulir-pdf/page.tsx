"use client";

import { useState } from "react";
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from "pdf-lib";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";

type Field =
  | { kind: "text"; name: string; value: string; multiline: boolean }
  | { kind: "check"; name: string; value: boolean }
  | { kind: "choice"; name: string; value: string; options: string[] }
  | { kind: "radio"; name: string; value: string; options: string[] };

function readFields(doc: PDFDocument): Field[] {
  const out: Field[] = [];
  for (const f of doc.getForm().getFields()) {
    const name = f.getName();
    if (f instanceof PDFTextField) out.push({ kind: "text", name, value: f.getText() ?? "", multiline: f.isMultiline() });
    else if (f instanceof PDFCheckBox) out.push({ kind: "check", name, value: f.isChecked() });
    else if (f instanceof PDFDropdown) out.push({ kind: "choice", name, value: f.getSelected()[0] ?? "", options: f.getOptions() });
    else if (f instanceof PDFOptionList) out.push({ kind: "choice", name, value: f.getSelected()[0] ?? "", options: f.getOptions() });
    else if (f instanceof PDFRadioGroup) out.push({ kind: "radio", name, value: f.getSelected() ?? "", options: f.getOptions() });
  }
  return out;
}

export default function IsiFormulirPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [flatten, setFlatten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note: string } | null>(null);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const fs = readFields(doc);
      if (fs.length === 0) {
        setError("PDF ini tidak punya kolom formulir yang bisa diisi. Untuk menulis di atas PDF biasa, pakai Edit PDF.");
        return;
      }
      setFile(f);
      setFields(fs);
    } catch {
      setError("PDF tidak bisa dibaca (mungkin terkunci password).");
    }
  };

  const update = (i: number, v: string | boolean) =>
    setFields((fs) => fs.map((f, j) => (j === i ? ({ ...f, value: v } as Field) : f)));

  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const form = doc.getForm();
      let skipped = 0;
      for (const f of fields) {
        try {
          if (f.kind === "text") {
            const tf = form.getTextField(f.name);
            if (f.value) tf.setText(f.value); else tf.setText(undefined);
          } else if (f.kind === "check") {
            const cb = form.getCheckBox(f.name);
            if (f.value) cb.check(); else cb.uncheck();
          } else if (f.kind === "radio") {
            if (f.value) form.getRadioGroup(f.name).select(f.value);
          } else if (f.value) {
            const fld = form.getField(f.name);
            if (fld instanceof PDFDropdown) fld.select(f.value);
            else if (fld instanceof PDFOptionList) fld.select(f.value);
          }
        } catch {
          skipped++; // usually a character the font cannot draw
        }
      }
      if (flatten) form.flatten();
      const bytes = await doc.save();
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        name: `${baseName(file.name)}-terisi.pdf`,
        note: `${fields.length} kolom${flatten ? ", dikunci jadi teks biasa" : ", masih bisa diedit lagi"}.${skipped ? ` ${skipped} kolom gagal diisi (karakter tidak didukung font formulir).` : ""}`,
      });
    } catch {
      setError("Gagal menyimpan formulir.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Isi Formulir PDF"
      description="Isi kolom formulir PDF asli (teks, centang, pilihan) langsung di browser, lalu unduh. Untuk PDF biasa tanpa kolom formulir, pakai Edit PDF."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih PDF formulir" hint="Hanya PDF yang punya kolom formulir (AcroForm)." />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">{file.name} · {formatBytes(file.size)} · {fields.length} kolom</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f, i) => (
              <div key={f.name + i} className={f.kind === "text" && f.multiline ? "sm:col-span-2" : ""}>
                <FieldLabel>{f.name}</FieldLabel>
                {f.kind === "text" && !f.multiline && <TextInput value={f.value} onChange={(e) => update(i, e.target.value)} />}
                {f.kind === "text" && f.multiline && (
                  <textarea value={f.value} onChange={(e) => update(i, e.target.value)} rows={3} className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-slate-700 outline-none focus:border-accent" />
                )}
                {f.kind === "check" && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={f.value} onChange={(e) => update(i, e.target.checked)} /> Dicentang
                  </label>
                )}
                {(f.kind === "choice" || f.kind === "radio") && (
                  <Select value={f.value} onChange={(e) => update(i, e.target.value)}>
                    <option value="">(kosong)</option>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                )}
              </div>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
            Kunci hasil (jadikan teks biasa, tidak bisa diedit lagi)
          </label>
          <div className="mt-4 flex items-center gap-3">
            <PrimaryButton onClick={save} busy={busy}>Simpan PDF</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setFields([]); setResult(null); setError(""); }}>Ganti berkas</SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result && <ResultCard filename={result.name} sizeLabel={formatBytes(result.blob.size)} note={result.note} onDownload={() => downloadBlob(result.blob, result.name)} />}
    </ToolShell>
  );
}
