"use client";

import { Download, Loader2, RotateCcw } from "lucide-react";

export function PrimaryButton({
  onClick,
  disabled,
  busy,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-panel2"
    >
      <RotateCcw size={14} /> {children}
    </button>
  );
}

export function ResultCard({
  filename,
  sizeLabel,
  onDownload,
  note,
}: {
  filename: string;
  sizeLabel?: string;
  onDownload: () => void;
  note?: string;
}) {
  return (
    <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4 sm:flex-row sm:items-center">
      <div>
        <p className="text-sm font-semibold text-emerald-300">
          Selesai: {filename}
          {sizeLabel && (
            <span className="ml-2 font-normal text-slate-400">{sizeLabel}</span>
          )}
        </p>
        {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
      </div>
      <button
        onClick={onDownload}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
      >
        <Download size={15} /> Unduh
      </button>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-blue-500 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-blue-500 ${props.className ?? ""}`}
    />
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
      {children}
    </p>
  );
}
