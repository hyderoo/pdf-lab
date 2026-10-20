import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { auth, signOut } from "@/auth";
import { site } from "@/lib/site";
import Link from "next/link";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
});

export const metadata: Metadata = {
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
};

async function Header() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/undip-logo.png" alt="Logo Undip" className="h-8 w-auto" />
          <span className="text-[15px] font-bold tracking-tight text-slate-800">
            {site.name}
            <span className="ml-2 hidden text-[11px] font-medium text-slate-500 sm:inline">
untuk sivitas Undip
            </span>
          </span>
        </Link>
        {session?.user && (
          <div className="flex items-center gap-3">
            <span className="hidden max-w-55 truncate text-xs text-slate-500 sm:inline">
              {session.user.email}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/masuk" });
              }}
            >
              <button
                type="submit"
                title="Keluar"
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-panel2"
              >
                <LogOut size={13} /> Keluar
              </button>
            </form>
          </div>
        )}
      </div>
    <div className="h-[3px] bg-accent" />
    </header>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className={`${jakarta.variable} min-h-screen antialiased`}>
        <Suspense fallback={<div className="h-14 border-b border-line" />}>
          <Header />
        </Suspense>
        {children}
        <footer className="border-t border-line py-6">
          <div className="mx-auto max-w-6xl px-4 text-center text-xs leading-relaxed text-slate-500">
            <p>
              Berkas diproses sepenuhnya di browser kamu — tidak ada berkas yang
              diunggah atau disimpan di server.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
