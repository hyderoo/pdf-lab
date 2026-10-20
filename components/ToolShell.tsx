import Link from "next/link";
import { ArrowLeft, ShieldCheck, Sparkles } from "lucide-react";

export default function ToolShell({
  title,
  description,
  ai = false,
  children,
}: {
  title: string;
  description: string;
  ai?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-200"
      >
        <ArrowLeft size={14} /> Semua alat
      </Link>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-100">
          {title}
          {ai && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">
              <Sparkles size={11} /> AI
            </span>
          )}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
          {description}
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-emerald-400">
          <ShieldCheck size={12} />
          {ai
            ? "Teks dikirim ke penyedia AI untuk diproses; berkas PDF asli tetap di browser kamu."
            : "Berkas diproses di browser kamu dan tidak pernah diunggah."}
        </p>
      </div>
      {children}
    </main>
  );
}
