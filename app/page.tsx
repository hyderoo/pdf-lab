"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Sparkles, ShieldCheck } from "lucide-react";
import { tools, categories } from "@/lib/tools";

export default function Home() {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle)
    );
  }, [q]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">
          Pilih alat
        </h1>
        <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-slate-400">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          Berkas kamu diproses langsung di browser dan tidak pernah diunggah ke
          server. Pengecualian: alat bertanda AI mengirim isi teks ke penyedia
          AI setelah kamu diberi tahu.
        </p>
      </div>

      <div className="relative mb-8 max-w-md">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari alat…"
          className="w-full rounded-xl border border-line bg-panel py-2.5 pl-9 pr-3 text-sm text-slate-200 outline-none transition placeholder:text-slate-500 focus:border-blue-500"
        />
      </div>

      {categories.map((cat) => {
        const items = filtered.filter((t) => t.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat} className="mb-9">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-blue-400">
              {cat}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((t) => (
                <Link
                  key={t.slug}
                  href={`/${t.slug}`}
                  className="group rounded-xl border border-line bg-panel p-4 transition hover:border-blue-500/50 hover:bg-panel2"
                >
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/12 text-blue-400 transition group-hover:bg-blue-600/20">
                      <t.icon size={18} />
                    </span>
                    <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-100">
                      {t.title}
                      {t.ai && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-300">
                          <Sparkles size={9} /> AI
                        </span>
                      )}
                    </h3>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    {t.description}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">
          Tidak ada alat yang cocok dengan &quot;{q}&quot;.
        </p>
      )}
    </main>
  );
}
