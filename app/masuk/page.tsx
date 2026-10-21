import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ShieldCheck, FileLock2 } from "lucide-react";
import { site } from "@/lib/site";

export const instant = false;

export default async function MasukPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const session = await auth();
  if (session) redirect("/");
  const { error } = await searchParams;
  const hasGoogle = !!process.env.AUTH_GOOGLE_ID;
  const hasMicrosoft = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/undip-logo.png" alt="Logo Undip" className="h-11 w-auto" />
          <div>
            <h1 className="text-xl font-bold text-slate-800">{site.name}</h1>
            <p className="text-sm text-slate-500">{site.tagline}</p>
          </div>
        </div>

        {error === "AccessDenied" && (
          <div className="mb-5 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Email yang kamu pakai bukan email Undip. Masuk dengan email
            @undip.ac.id, @live.undip.ac.id, @student.undip.ac.id,
            @students.undip.ac.id, atau @alumni.undip.ac.id.
          </div>
        )}

        <p className="mb-5 text-sm leading-relaxed text-slate-500">
          Khusus sivitas Undip: mahasiswa, dosen, staf, dan alumni. Masuk
          dengan email Undip kamu.
        </p>

        <div className="space-y-3">
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-soft"
            >
              Masuk dengan Google
            </button>
          </form>
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-panel2"
            >
              Masuk dengan Microsoft
            </button>
          </form>
        </div>

        <div className="mt-6 space-y-2 text-xs leading-relaxed text-slate-500">
          <p className="flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
            Email mahasiswa SSO (@students) dan alumni (@alumni) pakai tombol
            Microsoft; email @student, @undip.ac.id, dan @live pakai Google.
          </p>
          <p className="flex items-start gap-2">
            <FileLock2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
            Semua berkas diproses di browser kamu dan tidak pernah diunggah ke
            server. Server hanya memeriksa email saat masuk.
          </p>
        </div>

      </div>
    </main>
  );
}
