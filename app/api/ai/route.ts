import { auth } from "@/auth";
import { NextResponse } from "next/server";

const MAX_CHARS = 120_000;

export async function POST(req: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Belum masuk." }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Fitur AI belum dikonfigurasi (GEMINI_API_KEY belum dipasang)." },
      { status: 503 }
    );
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  let body: { action?: string; text?: string; targetLang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Teks kosong." }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Teks terlalu panjang (maks. ${MAX_CHARS.toLocaleString("id-ID")} karakter).` },
      { status: 413 }
    );
  }

  let prompt: string;
  if (body.action === "summarize") {
    prompt =
      "Ringkas dokumen berikut dalam bahasa Indonesia yang jelas dan padat. " +
      "Gunakan struktur: 1 paragraf ringkasan utama, lalu poin-poin penting (maksimal 10), lalu satu paragraf kesimpulan. " +
      "Jangan menambahkan informasi di luar dokumen.\n\nDOKUMEN:\n" + text;
  } else if (body.action === "translate") {
    const target = body.targetLang === "en" ? "bahasa Inggris" : "bahasa Indonesia";
    prompt =
      `Terjemahkan dokumen berikut ke ${target} dengan setia, pertahankan makna, istilah teknis, dan struktur per bagian. ` +
      "Jangan menambahkan komentar apa pun selain hasil terjemahan.\n\nDOKUMEN:\n" + text;
  } else {
    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    if (resp.status === 429) {
      return NextResponse.json(
        { error: "Kuota gratis AI habis untuk sementara. Coba lagi beberapa menit lagi." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: `Gagal memproses AI (${resp.status}).`, detail: detail.slice(0, 300) },
      { status: 502 }
    );
  }

  const data = await resp.json();
  const result =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim() ?? "";
  if (!result) {
    return NextResponse.json({ error: "AI tidak menghasilkan jawaban." }, { status: 502 });
  }
  return NextResponse.json({ result });
}
