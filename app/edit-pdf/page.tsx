"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolShell from "@/components/ToolShell";
import FileDrop from "@/components/FileDrop";
import { PrimaryButton, SecondaryButton, ResultCard, ErrorNote, FieldLabel } from "@/components/ui";
import { loadPdfJsDoc, downloadBlob, formatBytes, baseName } from "@/lib/pdf";
import { exportPdfWithAnnotations, hexToRgb, type Annotation } from "@/lib/editor";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Type, Highlighter, PenLine, Square, Circle, MoveRight, Minus, Image as ImageIcon, Eraser, MousePointer2, Undo2, Trash2 } from "lucide-react";

type Tool =
  | "select" | "text" | "highlight" | "pen" | "rect" | "ellipse"
  | "line" | "arrow" | "image" | "whiteout";

const TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: "select", label: "Pilih", icon: <MousePointer2 size={15} /> },
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
  const imgInput = useRef<HTMLInputElement | null>(null);
  const imgTarget = useRef<{ page: number; x: number; y: number } | null>(null);

  const onFile = async (f: File) => {
    setError("");
    setResult(null);
    setAnnots([]);
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
      description="Tambahkan teks, highlight, coretan, bentuk, gambar, atau whiteout di atas PDF. Semua diproses di browser."
    >
      {!file ? (
        <FileDrop accept="application/pdf" onFiles={(fs) => fs[0] && onFile(fs[0])} label="Pilih satu PDF untuk diedit" />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {file.name} · {numPages} halaman · {formatBytes(file.size)}
          </p>
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            Anotasi digambar di atas isi PDF. Teks yang sudah ada di PDF tidak bisa diubah langsung;
            tutup dengan whiteout lalu tambahkan teks baru di atasnya.
          </div>

          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white p-2 shadow-sm">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                title={t.label}
                className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${tool === t.id ? "bg-cobalt text-white" : "text-slate-600 hover:bg-slate-100"}`}
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
  }
}

function PageCanvas({
  doc, page, scale, annots, selected, onPointerDown, onPointerMove, onPointerUp, tool,
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
    }
  };

  return (
    <div
      className="relative border border-line bg-white shadow-sm"
      style={{ width: dims?.w ?? PAGE_W, height: dims?.h ?? PAGE_W * 1.3, touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
      onPointerDown={(e) => onPointerDown(e, page)}
      onPointerMove={(e) => onPointerMove(e, page)}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <svg className="absolute inset-0" width={dims?.w ?? PAGE_W} height={dims?.h ?? 0}>
        {annots.map(drawAnnot)}
      </svg>
    </div>
  );
}
