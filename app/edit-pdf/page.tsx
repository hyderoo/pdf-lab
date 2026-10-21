"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel } from "@/components/ui";
import { loadPdfJsDoc, downloadBlob, formatBytes, baseName, extractTextLines, type EditableLine } from "@/lib/pdf";
import { exportPdfWithAnnotations, hexToRgb, wrapToWidth, type Annotation } from "@/lib/editor";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Type, Highlighter, PenLine, Square, Circle, MoveRight, Minus, Image as ImageIcon, Eraser, MousePointer2, Undo2, Trash2, PencilLine } from "lucide-react";

type Tool =
  | "select" | "editText" | "text" | "highlight" | "pen" | "rect" | "ellipse"
  | "line" | "arrow" | "image" | "whiteout";

const TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: "select", label: "Pilih", icon: <MousePointer2 size={15} /> },
  { id: "editText", label: "Edit teks", icon: <PencilLine size={15} /> },
  { id: "text", label: "Teks", icon: <Type size={15} /> },
  { id: "highlight", label: "Highlight", icon: <Highlighter size={15} /> },
  { id: "pen", label: "Gambar", icon: <PenLine size={15} /> },
  { id: "rect", label: "Persegi", icon: <Square size={15} /> },
  { id: "ellipse", label: "Elips", icon: <Circle size={15} /> },
  { id: "line", label: "Garis", icon: <Minus size={15} /> },
  { id: "arrow", label: "Panah", icon: <MoveRight size={15} /> },
  { id: "image", label: "Gambar/TTD", icon: <ImageIcon size={15} /> },
  { id: "whiteout", label: "Whiteout", icon: <Eraser size={15} /> },
];

const COLORS = ["#1e293b", "#dc2626", "#0047AB", "#16a34a", "#f59e0b"];
const PAGE_W = 780;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function EditPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scales, setScales] = useState<Record<number, number>>({});
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[0]);
  const [thickness, setThickness] = useState(2.5);
  const [textSize, setTextSize] = useState(14);
  const [annots, setAnnots] = useState<Annotation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const [textDraft, setTextDraft] = useState<{ page: number; x: number; y: number; value: string } | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [linesReady, setLinesReady] = useState(false);
  const [hint, setHint] = useState("");
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHint = (msg: string) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(""), 4000);
  };
  const [editDraft, setEditDraft] = useState<{ x: number; baseY: number; w: number; size: number; bold: boolean; page: number; orig: string; value: string; rightX?: number } | null>(null);
  const canvases = useRef<Record<number, HTMLCanvasElement | null>>({});
  const imgInput = useRef<HTMLInputElement | null>(null);
  const imgTarget = useRef<{ page: number; x: number; y: number } | null>(null);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    setAnnots([]);
    setLines([]);
    setLinesReady(false);
    try {
      const buf = await f.arrayBuffer();
      const d = await loadPdfJsDoc(buf.slice(0));
      const sc: Record<number, number> = {};
      for (let i = 1; i <= d.numPages; i++) {
        const vp = (await d.getPage(i)).getViewport({ scale: 1 });
        sc[i] = PAGE_W / vp.width;
      }
      setFile(f);
      setDoc(d);
      setNumPages(d.numPages);
      setScales(sc);
      setLinesReady(false);
      try {
        setLines(await extractTextLines(d, sc, buf.slice(0)));
      } catch {
        setLines([]);
      }
      setLinesReady(true);
    } catch {
      setError("PDF tidak bisa dibaca.");
    }
  };

  const undo = () => setAnnots((a) => a.slice(0, -1));
  const deleteSelected = () => {
    if (selected) setAnnots((a) => a.filter((x) => x.id !== selected));
    setSelected(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !textDraft) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, textDraft]);

  const pagePoint = (e: React.PointerEvent, page: number) => {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    return { page, x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const drag = useRef<{ start: { page: number; x: number; y: number } | null; cur: Annotation | null; move?: { id: string; dx: number; dy: number } }>({ start: null, cur: null });

  const onPointerDown = (e: React.PointerEvent, page: number) => {
    const pt = pagePoint(e, page);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === "select") {
      // hit test: latest annotation whose bbox contains the point
      const hit = [...annots].reverse().find((a) => a.page === page && bbox(a, S(page)).some(([x1, y1, x2, y2]) => pt.x >= x1 - 4 && pt.x <= x2 + 4 && pt.y >= y1 - 4 && pt.y <= y2 + 4));
      if (hit) {
        setSelected(hit.id);
        const [x1, y1] = bbox(hit, S(page))[0];
        drag.current.move = { id: hit.id, dx: pt.x - x1, dy: pt.y - y1 };
      } else setSelected(null);
      return;
    }
    if (tool === "editText") {
      if (!linesReady) {
        showHint("Teks PDF masih diproses - tunggu sesaat, lalu klik barisnya lagi.");
        return;
      }
      const hit = hitLine(lines, page, pt.x, pt.y);
      if (!hit) {
        showHint(lines.length ? "Klik pas di atas baris teks yang mau diganti." : "Tidak ada teks yang terbaca di PDF ini, jadi tidak ada baris yang bisa diganti.");
        return;
      }
      if (hit) {
        const colorGuess = sampleTextColor(canvases.current[page], hit.x, hit.baseY, hit.w, hit.size);
        setEditDraft({ x: hit.x, baseY: hit.baseY, w: hit.w, size: hit.size, bold: hit.bold, page, orig: hit.text, value: hit.text, rightX: hit.rightX });
        void colorGuess;
        setColor(colorGuess);
      }
      return;
    }
    if (tool === "text") {
      setTextDraft({ page, x: pt.x, y: pt.y, value: "" });
      return;
    }
    if (tool === "image") {
      imgTarget.current = pt;
      imgInput.current?.click();
      return;
    }
    drag.current.start = pt;
    if (tool === "pen") {
      drag.current.cur = { id: uid(), type: "pen", page, points: [pt.x, pt.y], color, thickness };
    }
  };

  const onPointerMove = (e: React.PointerEvent, page: number) => {
    const pt = pagePoint(e, page);
    if (drag.current.move) {
      const { id, dx, dy } = drag.current.move;
      setAnnots((list) => list.map((a) => (a.id === id ? moveTo(a, pt.x - dx, pt.y - dy) : a)));
      return;
    }
    if (!drag.current.start) return;
    const s = drag.current.start;
    if (tool === "pen" && drag.current.cur?.type === "pen") {
      drag.current.cur.points.push(pt.x, pt.y);
      setAnnots((list) => {
        const others = list.filter((x) => x.id !== drag.current.cur!.id);
        return [...others, drag.current.cur!];
      });
      return;
    }
    const x = Math.min(s.x, pt.x), y = Math.min(s.y, pt.y);
    const w = Math.abs(pt.x - s.x), h = Math.abs(pt.y - s.y);
    let cur: Annotation | null = null;
    if (tool === "highlight") cur = { id: drag.current.cur?.id ?? uid(), type: "highlight", page, x, y, w, h, color: color === COLORS[0] ? "#fde047" : color, thickness };
    else if (tool === "whiteout") cur = { id: drag.current.cur?.id ?? uid(), type: "whiteout", page, x, y, w, h, color: "#ffffff", thickness };
    else if (tool === "rect") cur = { id: drag.current.cur?.id ?? uid(), type: "rect", page, x, y, w, h, color, thickness };
    else if (tool === "ellipse") cur = { id: drag.current.cur?.id ?? uid(), type: "ellipse", page, x, y, w, h, color, thickness };
    else if (tool === "line") cur = { id: drag.current.cur?.id ?? uid(), type: "line", page, x1: s.x, y1: s.y, x2: pt.x, y2: pt.y, color, thickness };
    else if (tool === "arrow") cur = { id: drag.current.cur?.id ?? uid(), type: "arrow", page, x1: s.x, y1: s.y, x2: pt.x, y2: pt.y, color, thickness };
    if (cur) {
      drag.current.cur = cur;
      setAnnots((list) => [...list.filter((a) => a.id !== cur!.id), cur!]);
    }
  };

  const onPointerUp = () => {
    const cur = drag.current.cur;
    if (tool === "highlight" && cur && cur.type === "highlight" && linesReady) {
      // Snap the dragged area to the text lines it covers (like selecting text),
      // instead of leaving a free rectangle. Areas without text keep the free rect.
      const x1 = cur.x, y1 = cur.y, x2 = cur.x + cur.w, y2 = cur.y + cur.h;
      const snapped: Annotation[] = [];
      for (const l of lines) {
        if (l.page !== cur.page) continue;
        const ly1 = l.baseY - l.size * 1.12;
        const ly2 = l.baseY + l.size * 0.38;
        if (ly2 < y1 || ly1 > y2) continue;
        const segs: [number, number][] = [[l.x - 1, l.x + l.w + 1]];
        if (l.date) segs.push([l.date.x - 1, l.date.x + l.date.w + 1]);
        for (const [sx1, sx2] of segs) {
          const ix1 = Math.max(sx1, x1), ix2 = Math.min(sx2, x2);
          if (ix2 <= ix1) continue;
          snapped.push({ id: uid(), type: "highlight", page: cur.page, x: ix1, y: ly1, w: ix2 - ix1, h: ly2 - ly1, color: cur.color, thickness: cur.thickness });
        }
      }
      if (snapped.length) setAnnots((list) => [...list.filter((a) => a.id !== cur.id), ...snapped]);
    }
    drag.current.start = null;
    drag.current.cur = null;
    drag.current.move = undefined;
  };

  const commitText = () => {
    if (!textDraft) return;
    if (textDraft.value.trim()) {
      setAnnots((a) => [
        ...a,
        { id: uid(), type: "text", page: textDraft.page, x: textDraft.x, y: textDraft.y, text: textDraft.value, size: textSize, color, bold: false },
      ]);
    }
    setTextDraft(null);
  };

  const commitEdit = () => {
    if (!editDraft) return;
    if (editDraft.value.trim() && editDraft.value !== editDraft.orig) {
      setAnnots((a) => [
        ...a,
        { id: uid(), type: "edit", page: editDraft.page, x: editDraft.x, baseY: editDraft.baseY, w: editDraft.w, size: editDraft.size, bold: editDraft.bold, color, text: editDraft.value, rightX: editDraft.rightX },
      ]);
    }
    setEditDraft(null);
  };

  const onImagePicked = async (f: File) => {
    const pt = imgTarget.current;
    if (!pt) return;
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(f);
    });
    const dims = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = dataUrl;
    });
    const w = Math.min(220, dims.w);
    const h = (w / dims.w) * dims.h;
    setAnnots((a) => [...a, { id: uid(), type: "image", page: pt.page, x: pt.x, y: pt.y, w, h, dataUrl }]);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const blob = await exportPdfWithAnnotations(buf, annots, scales);
      const name = `${baseName(file.name)}-edit.pdf`;
      setResult({ blob, name });
      downloadBlob(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan PDF.");
    } finally {
      setBusy(false);
    }
  };

  const S = (p: number) => scales[p] ?? 1;

  return (
    <ToolShell
      title="Edit PDF"
      description="Ganti teks yang ada, atau tambahkan teks, highlight, coretan, bentuk, gambar, dan whiteout di atas PDF. Semua diproses di browser."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF untuk diedit" />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {file.name} · {numPages} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            Anotasi digambar di atas isi PDF. Dengan alur "Edit teks", baris teks asli bisa diganti: klik barisnya,
            ketik penggantinya, lalu teks lama ditimpa whiteout dan teks baru digambar di posisi yang sama. Bentuk huruf bisa sedikit berbeda dari font asli.
          </div>

          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white p-2 shadow-sm">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTool(t.id); if (t.id === "highlight") setColor(COLORS[0]); }}
                title={t.label}
                className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${tool === t.id ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200" />
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-5 w-5 rounded-full border-2 ${color === c ? "border-slate-800" : "border-white"}`}
                style={{ background: c }}
              />
            ))}
            <label className="ml-1 flex items-center gap-1 text-[11px] text-slate-500">
              Tebal
              <input type="range" min={1} max={8} step={0.5} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} className="w-16" />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              Font
              <input type="range" min={9} max={28} step={1} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="w-16" />
            </label>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <button onClick={undo} title="Urungkan" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"><Undo2 size={15} /></button>
            <button onClick={deleteSelected} disabled={!selected} title="Hapus anotasi terpilih" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Trash2 size={15} /></button>
            {hint && <div className="basis-full rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs text-sky-800">{hint}</div>}
          </div>

          <div className="mb-4 flex flex-col items-center gap-5">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <PageCanvas
                key={p}
                doc={doc!}
                page={p}
                scale={S(p)}
                annots={annots.filter((a) => a.page === p)}
                selected={selected}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                tool={tool}
                registerCanvas={(el) => { canvases.current[p] = el; }}
              />
            ))}
          </div>

          {textDraft && (
            <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30" onClick={commitText}>
              <div className="w-96 rounded-lg bg-white p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <FieldLabel>Teks baru</FieldLabel>
                <textarea
                  autoFocus
                  value={textDraft.value}
                  onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
                  className="h-24 w-full rounded-md border border-line p-2 text-sm"
                  placeholder="Ketik teks..."
                />
                <div className="mt-2 flex justify-end gap-2">
                  <SecondaryButton onClick={() => setTextDraft(null)}>Batal</SecondaryButton>
                  <PrimaryButton onClick={commitText}>Tambah</PrimaryButton>
                </div>
              </div>
            </div>
          )}

          {editDraft && (
            <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30" onClick={commitEdit}>
              <div className="w-[28rem] rounded-lg bg-white p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <FieldLabel>Edit teks baris ini</FieldLabel>
                <p className="mb-2 line-clamp-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">Asli: {editDraft.orig}</p>
                <textarea
                  autoFocus
                  value={editDraft.value}
                  onChange={(e) => setEditDraft({ ...editDraft, value: e.target.value })}
                  className="h-24 w-full rounded-md border border-line p-2 text-sm"
                />
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  Teks asli ditutup whiteout, lalu teks baru digambar dengan Helvetica
                  {editDraft.bold ? " Bold" : ""} {Math.round(editDraft.size)}px — bentuk huruf bisa sedikit berbeda dari font asli.
                  Teks yang lebih panjang dari baris asli akan turun ke baris berikutnya.
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <SecondaryButton onClick={() => setEditDraft(null)}>Batal</SecondaryButton>
                  <PrimaryButton onClick={commitEdit}>Ganti teks</PrimaryButton>
                </div>
              </div>
            </div>
          )}

          <input
            ref={imgInput}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onImagePicked(e.target.files[0])}
          />

          <div className="flex items-center gap-3">
            <PrimaryButton onClick={run} busy={busy}>{busy ? "Menyimpan…" : "Unduh hasil edit"}</PrimaryButton>
            <SecondaryButton onClick={() => { setFile(null); setDoc(null); setAnnots([]); setResult(null); setError(""); }}>
              Ganti berkas
            </SecondaryButton>
          </div>
          <ErrorNote>{error}</ErrorNote>
          {result && (
            <ResultCard
              filename={result.name}
              sizeLabel={formatBytes(result.blob.size)}
              note="Unduhan dimulai otomatis. Klik Unduh untuk mengunduh ulang."
              onDownload={() => downloadBlob(result.blob, result.name)}
            />
          )}
        </>
      )}
    </ToolShell>
  );
}

function bbox(a: Annotation, _S: number): [number, number, number, number][] {
  switch (a.type) {
    case "text": return [[a.x - 2, a.y - a.size, a.x + 240, a.y + a.text.split("\n").length * a.size * 1.2]];
    case "highlight": case "whiteout": case "rect": case "ellipse": case "image":
      return [[a.x, a.y, a.x + a.w, a.y + a.h]];
    case "line": case "arrow":
      return [[Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.max(a.x1, a.x2), Math.max(a.y1, a.y2)]];
    case "pen": {
      const xs = a.points.filter((_, i) => i % 2 === 0);
      const ys = a.points.filter((_, i) => i % 2 === 1);
      return [[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]];
    }
    case "edit":
      return [[a.x, a.baseY - a.size * 1.1, a.x + a.w, a.baseY + a.size * 0.35]];
  }
}

function moveTo(a: Annotation, x: number, y: number): Annotation {
  switch (a.type) {
    case "text": return { ...a, x, y: y + a.size };
    case "highlight": case "whiteout": case "rect": case "ellipse": case "image":
      return { ...a, x, y };
    case "line": case "arrow": {
      const w = a.x2 - a.x1, h = a.y2 - a.y1;
      return { ...a, x1: x, y1: y, x2: x + w, y2: y + h };
    }
    case "pen": {
      const [x1, y1] = bbox(a, 1)[0];
      const dx = x - x1, dy = y - y1;
      return { ...a, points: a.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
    }
    case "edit":
      return { ...a, x, baseY: y + a.size * 1.1 };
  }
}

function PageCanvas({
  doc, page, scale, annots, selected, onPointerDown, onPointerMove, onPointerUp, tool, registerCanvas,
}: {
  doc: PDFDocumentProxy;
  page: number;
  scale: number;
  annots: Annotation[];
  selected: string | null;
  onPointerDown: (e: React.PointerEvent, page: number) => void;
  onPointerMove: (e: React.PointerEvent, page: number) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  tool: Tool;
  registerCanvas: (el: HTMLCanvasElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pg = await doc.getPage(page);
      const vp = pg.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      registerCanvas(canvas);
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d")!;
      await pg.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      if (!cancelled) setDims({ w: vp.width, h: vp.height });
    })();
    return () => { cancelled = true; };
  }, [doc, page, scale]);

  const drawAnnot = (a: Annotation): React.ReactNode => {
    const c = "color" in a ? a.color : "#000";
    const sel = a.id === selected;
    const selBox = sel ? (() => { const [x1, y1, x2, y2] = bbox(a, scale)[0]; return <rect key="sel" x={x1 - 3} y={y1 - 3} width={x2 - x1 + 6} height={y2 - y1 + 6} fill="none" stroke="#0047AB" strokeWidth={1} strokeDasharray="4 3" />; })() : null;
    switch (a.type) {
      case "text":
        return <g key={a.id}>{a.text.split("\n").map((l, i) => <text key={i} x={a.x} y={a.y + i * a.size * 1.2} fontSize={a.size} fill={c} fontWeight={a.bold ? 700 : 400}>{l}</text>)}{selBox}</g>;
      case "highlight": {
        const { r, g, b } = hexToRgb(c);
        return <g key={a.id}><rect x={a.x} y={a.y} width={a.w} height={a.h} fill={`rgba(${r * 255},${g * 255},${b * 255},0.35)`} />{selBox}</g>;
      }
      case "whiteout":
        return <g key={a.id}><rect x={a.x} y={a.y} width={a.w} height={a.h} fill="#fff" />{selBox}</g>;
      case "rect":
        return <g key={a.id}><rect x={a.x} y={a.y} width={a.w} height={a.h} fill="none" stroke={c} strokeWidth={a.thickness} />{selBox}</g>;
      case "ellipse":
        return <g key={a.id}><ellipse cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} fill="none" stroke={c} strokeWidth={a.thickness} />{selBox}</g>;
      case "line":
        return <g key={a.id}><line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={c} strokeWidth={a.thickness} />{selBox}</g>;
      case "arrow": {
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        const len = 10;
        return <g key={a.id}><line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={c} strokeWidth={a.thickness} />
          {[Math.PI * 0.82, -Math.PI * 0.82].map((da, i) => (
            <line key={i} x1={a.x2} y1={a.y2} x2={a.x2 + len * Math.cos(ang + da)} y2={a.y2 + len * Math.sin(ang + da)} stroke={c} strokeWidth={a.thickness} />
          ))}{selBox}</g>;
      }
      case "pen": {
        let d = `M ${a.points[0]} ${a.points[1]}`;
        for (let i = 2; i < a.points.length - 1; i += 2) d += ` L ${a.points[i]} ${a.points[i + 1]}`;
        return <g key={a.id}><path d={d} fill="none" stroke={c} strokeWidth={a.thickness} strokeLinecap="round" strokeLinejoin="round" />{selBox}</g>;
      }
      case "image":
        return <g key={a.id}><image href={a.dataUrl} x={a.x} y={a.y} width={a.w} height={a.h} />{selBox}</g>;
      case "edit": {
        if (a.rightX != null) {
          const wNew = measureText(a.text, a.size, a.bold);
          const xMin = Math.min(a.x, a.rightX - wNew);
          return (
            <g key={a.id}>
              <rect x={xMin - 1} y={a.baseY - a.size * 1.08} width={a.rightX - xMin + 2} height={a.size * 1.38} fill="#fff" />
              <text x={a.rightX} y={a.baseY} textAnchor="end" fontSize={a.size} fill={c} fontWeight={a.bold ? 700 : 400} fontFamily="Helvetica, Arial, sans-serif">{a.text}</text>
              {selBox}
            </g>
          );
        }
        const linesOv = wrapToWidth(
          a.text,
          a.w + 4,
          (w) => measureText(w, a.size, a.bold),
          measureText(" ", a.size, a.bold)
        );
        return (
          <g key={a.id}>
            <rect x={a.x - 1} y={a.baseY - a.size * 1.08} width={a.w + 2} height={a.size * 1.38} fill="#fff" />
            {linesOv.map((l, i) => (
              <text key={i} x={a.x} y={a.baseY + i * a.size * 1.2} fontSize={a.size} fill={c} fontWeight={a.bold ? 700 : 400} fontFamily="Helvetica, Arial, sans-serif">{l}</text>
            ))}
            {selBox}
          </g>
        );
      }
    }
  };

  return (
    <div
      className="relative select-none border border-line bg-white shadow-sm"
      style={{ width: dims?.w ?? PAGE_W, height: dims?.h ?? PAGE_W * 1.3, touchAction: "none", cursor: tool === "select" ? "default" : tool === "editText" ? "text" : "crosshair" }}
      onPointerDown={(e) => onPointerDown(e, page)}
      onPointerMove={(e) => onPointerMove(e, page)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <svg className="absolute inset-0 select-none" width={dims?.w ?? PAGE_W} height={dims?.h ?? 0}>
        {annots.map(drawAnnot)}
      </svg>
    </div>
  );
}

// Canvas text measurement for the overlay (approximates Helvetica metrics).
let measureCtx: CanvasRenderingContext2D | null = null;
function measureText(t: string, size: number, bold: boolean): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return t.length * size * 0.5;
  measureCtx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(t).width;
}

// Hit-test an extracted source line (its date piece wins when both overlap).
function hitLine(lines: EditableLine[], page: number, x: number, y: number): { x: number; baseY: number; w: number; size: number; bold: boolean; text: string; rightX?: number } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.page !== page) continue;
    if (l.date && x >= l.date.x - 6 && x <= l.date.x + l.date.w + 6 && y >= l.baseY - l.size * 1.15 && y <= l.baseY + l.size * 0.5) {
      return { x: l.date.x, baseY: l.baseY, w: l.date.w, size: l.size, bold: l.date.bold, text: l.date.text, rightX: l.date.x + l.date.w };
    }
    if (x >= l.x - 6 && x <= l.x + l.w + 6 && y >= l.baseY - l.size * 1.15 && y <= l.baseY + l.size * 0.5) {
      return { x: l.x, baseY: l.baseY, w: l.w, size: l.size, bold: l.bold, text: l.text };
    }
  }
  return null;
}

// Guess the source text color by averaging the dark pixels in the line box.
function sampleTextColor(canvas: HTMLCanvasElement | null, x: number, baseY: number, w: number, size: number): string {
  if (!canvas) return "#1e293b";
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return "#1e293b";
    const sx = Math.max(0, Math.round(x));
    const sy = Math.max(0, Math.round(baseY - size * 1.1));
    const sw = Math.min(canvas.width - sx, Math.round(w));
    const sh = Math.min(canvas.height - sy, Math.round(size * 1.4));
    if (sw <= 0 || sh <= 0) return "#1e293b";
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (data[i + 3] > 200 && lum < 110) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    if (n < 8) return "#1e293b";
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return "#1e293b";
  }
}
