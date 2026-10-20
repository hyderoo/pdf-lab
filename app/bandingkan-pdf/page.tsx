"use client";

import { useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ErrorNote } from "@/components/ui";
import { loadPdfJsDoc, extractAllText, formatBytes } from "@/lib/pdf";

type DiffLine = { kind: "same" | "added" | "removed"; text: string };

function diffWords(a: string, b: string): DiffLine[] {
  // Sentence-level diff with LCS for readability.
  const splitSent = (s: string) =>
    s.split(/(?<=[.!?;:\n])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const A = splitSent(a);
  const B = splitSent(b);
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ kind: "same", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "removed", text: A[i] }); i++; }
    else { out.push({ kind: "added", text: B[j] }); j++; }
  }
  while (i < n) out.push({ kind: "removed", text: A[i++] });
  while (j < m) out.push({ kind: "added", text: B[j++] });
  return out;
}

export default function BandingkanPdf() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [stats, setStats] = useState<{ added: number; removed: number } | null>(null);

  const run = async () => {
    if (!fileA || !fileB) return;
    setBusy(true);
    setError("");
    try {
      const [docA, docB] = await Promise.all([
        loadPdfJsDoc(await fileA.arrayBuffer()),
        loadPdfJsDoc(await fileB.arrayBuffer()),
      ]);
      const [tA, tB] = await Promise.all([extractAllText(docA), extractAllText(docB)]);
      const textA = tA.join("\n");
      const textB = tB.join("\n");
      if (!textA.trim() && !textB.trim()) throw new Error("Kedua PDF tidak punya teks yang bisa dibandingkan (mungkin hasil scan).");
      const d = diffWords(textA, textB);
      setDiff(d);
      setStats({
        added: d.filter((x) => x.kind === "added").length,
        removed: d.filter((x) => x.kind === "removed").length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membandingkan PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      title="Bandingkan PDF"
      description="Bandingkan dua versi PDF dan tandai kalimat yang ditambah, dihapus, atau diubah. Perbandingan berdasarkan teks, bukan tampilan."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Versi lama</p>
          {fileA ? (
            <p className="rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-slate-700">
              {fileA.name} <span className="text-xs text-slate-500">({formatBytes(fileA.size)})</span>
            </p>
          ) : (
            <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && setFileA(fs[0])} label="PDF versi lama" />
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Versi baru</p>
          {fileB ? (
            <p className="rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-slate-700">
              {fileB.name} <span className="text-xs text-slate-500">({formatBytes(fileB.size)})</span>
            </p>
          ) : (
            <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && setFileB(fs[0])} label="PDF versi baru" />
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={run} disabled={!fileA || !fileB} busy={busy}>
          Bandingkan
        </PrimaryButton>
        {(fileA || fileB) && (
          <SecondaryButton onClick={() => { setFileA(null); setFileB(null); setDiff(null); setError(""); }}>
            Ulang dari awal
          </SecondaryButton>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>

      {diff && stats && (
        <div className="mt-6">
          <p className="mb-3 text-sm text-slate-600">
            <span className="font-semibold text-emerald-600">{stats.added} kalimat ditambah</span>
            {" · "}
            <span className="font-semibold text-rose-600">{stats.removed} kalimat dihapus</span>
            {stats.added === 0 && stats.removed === 0 && " — teks kedua PDF identik."}
          </p>
          <div className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-4">
            {diff.map((d, i) =>
              d.kind === "same" ? (
                <p key={i} className="text-xs leading-relaxed text-slate-500">{d.text}</p>
              ) : d.kind === "added" ? (
                <p key={i} className="rounded bg-emerald-50 px-2 py-1 text-xs leading-relaxed text-emerald-700">+ {d.text}</p>
              ) : (
                <p key={i} className="rounded bg-rose-50 px-2 py-1 text-xs leading-relaxed text-rose-700 line-through">− {d.text}</p>
              )
            )}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
