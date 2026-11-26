"use client";

import { useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel, TextInput, Select } from "@/components/ui";
import { downloadBlob, formatBytes, baseName } from "@/lib/pdf";

// qpdf compiled to WASM, vendored under /public/qpdf (same-origin only, CSP-safe).
type Qpdf = {
  callMain: (args: string[]) => number;
  FS: { writeFile: (p: string, d: Uint8Array) => void; readFile: (p: string) => Uint8Array };
};
type QpdfFactory = (opts: { locateFile: () => string; noInitialRun: boolean; print: (s: string) => void; printErr: (s: string) => void }) => Promise<Qpdf>;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("script"));
    document.head.appendChild(el);
  });
}

async function runQpdf(bytes: Uint8Array, args: string[]): Promise<{ code: number; out: Uint8Array | null; log: string }> {
  const w = window as unknown as { Module?: QpdfFactory };
  if (!w.Module) await loadScript("/qpdf/qpdf.js");
  const factory = w.Module;
  if (!factory) throw new Error("qpdf gagal dimuat.");
  let log = "";
  const q = await factory({
    locateFile: () => "/qpdf/qpdf.wasm",
    noInitialRun: true,
    print: (s) => { log += s + "\n"; },
    printErr: (s) => { log += s + "\n"; },
  });
  q.FS.writeFile("/in.pdf", bytes);
  let code = 0;
  try {
    code = q.callMain([...args, "/in.pdf", "/out.pdf"]);
  } catch (e) {
    const status = (e as { status?: number })?.status;
    code = typeof status === "number" ? status : 1;
  }
  let out: Uint8Array | null = null;
  try { out = q.FS.readFile("/out.pdf"); } catch { out = null; }
  return { code, out, log };
}

export default function PasswordPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("kunci");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [allowPrint, setAllowPrint] = useState("y");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; note: string } | null>(null);

  const run = async () => {
    if (!file) return;
    setError("");
    setResult(null);
    if (!pw) { setError(mode === "kunci" ? "Isi password yang diinginkan." : "Isi password PDF ini."); return; }
    if (mode === "kunci" && pw !== pw2) { setError("Konfirmasi password tidak sama."); return; }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let res;
      if (mode === "buka" && !new TextDecoder("latin1").decode(bytes).includes("/Encrypt")) {
        setError("PDF ini tidak dikunci password.");
        return;
      }
      if (mode === "kunci") {
        // AES-256. Same password opens the file; copying/editing needs the owner password (same value here).
        res = await runQpdf(bytes, ["--encrypt", pw, pw, "256", `--print=${allowPrint === "y" ? "full" : "none"}`, "--"]);
      } else {
        res = await runQpdf(bytes, [`--password=${pw}`, "--decrypt"]);
      }
      if (res.code !== 0 && res.code !== 3) {
        setError(mode === "buka" ? "Password salah, atau PDF ini tidak bisa dibuka." : "Gagal memproses PDF.");
        return;
      }
      if (!res.out || res.out.length === 0) { setError("Gagal memproses PDF."); return; }
      setResult({
        blob: new Blob([new Uint8Array(res.out).buffer as ArrayBuffer], { type: "application/pdf" }),
        name: `${baseName(file.name)}-${mode === "kunci" ? "terkunci" : "terbuka"}.pdf`,
        note:
          mode === "kunci"
            ? "Dienkripsi AES-256. Password tidak bisa dipulihkan kalau lupa, simpan baik-baik."
            : "Password dihapus: PDF ini bisa dibuka tanpa password.",
      });
    } catch {
      setError("Gagal memproses PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Password PDF"
      description="Kunci PDF dengan password (enkripsi AES-256) atau hapus password dari PDF yang kamu tahu passwordnya. Password dan berkas tidak pernah dikirim ke mana pun."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && setFile(fs[0])} label="Pilih satu PDF" />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">{file.name} · {formatBytes(file.size)}</p>
          <div className="mb-4 grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel>Aksi</FieldLabel>
              <Select value={mode} onChange={(e) => { setMode(e.target.value); setError(""); setResult(null); }}>
                <option value="kunci">Kunci PDF dengan password</option>
                <option value="buka">Hapus password dari PDF</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{mode === "kunci" ? "Password baru" : "Password PDF"}</FieldLabel>
              <TextInput type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
            </div>
            {mode === "kunci" && (
              <>
                <div>
                  <FieldLabel>Ulangi password</FieldLabel>
                  <TextInput type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="off" />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>Cetak</FieldLabel>
                  <Select value={allowPrint} onChange={(e) => setAllowPrint(e.target.value)}>
                    <option value="y">Boleh dicetak</option>
                    <option value="n">Tidak boleh dicetak</option>
                  </Select>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>{mode === "kunci" ? "Kunci PDF" : "Hapus password"}</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setResult(null); setError(""); setPw(""); setPw2(""); }}>Ganti berkas</SecondaryButton>
          </div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {result && <ResultCard filename={result.name} sizeLabel={formatBytes(result.blob.size)} note={result.note} onDownload={() => downloadBlob(result.blob, result.name)} />}
    </ToolShell>
  );
}
