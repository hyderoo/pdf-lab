import { auth } from "@/auth";
import { NextResponse } from "next/server";

const MAX_CHARS = 120_000;

// Safety net: models sometimes still emit markdown despite the prompt.
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*+]\s+/gm, "- ");
}



async function callGemini(
  prompt: string,
  key: string,
  model: string
): Promise<string | NextResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
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
  const raw =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "AI tidak menghasilkan jawaban." }, { status: 502 });
  }
  return raw;
}

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

  let body: { action?: string; text?: string; targetLang?: string; blocks?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  // Block-structured translation: translate each block, return JSON array.
  if (body.action === "translateBlocks") {
    const blocks = (body.blocks ?? []).map((b) => String(b ?? "").trim());
    if (!blocks.length || blocks.some((b) => !b)) {
      return NextResponse.json({ error: "Blok teks kosong." }, { status: 400 });
    }
    const joined = blocks.join("\n");
    if (joined.length > MAX_CHARS) {
      return NextResponse.json(
        { error: `Teks terlalu panjang (maks. ${MAX_CHARS.toLocaleString("id-ID")} karakter).` },
        { status: 413 }
      );
    }
    const target = body.targetLang === "en" ? "bahasa Inggris" : "bahasa Indonesia";
    const prompt =
      `Terjemahkan setiap elemen array JSON berikut ke ${target}. ` +
      "Kembalikan HANYA satu array JSON berisi string hasil terjemahan, dengan jumlah elemen dan urutan yang PERSIS sama. " +
      "Setiap elemen adalah satu potongan teks dari sebuah dokumen; jangan menggabung atau memecah elemen. " +
      "Nama diri, nama merek, nama produk, URL, dan alamat email tetap persis seperti aslinya. Semua kalimat lain WAJIB diterjemahkan sepenuhnya ke " + target + ". " +
      "Jaga persis tanda baca pemisah seperti en dash (–), em dash (—), middot (·), pipe (|), dan &: jangan dihapus, diganti spasi, atau diubah jadi tanda lain. " +
      "Untuk rentang tanggal seperti \"Jun 2026 – Present\", terjemahkan hanya katanya (mis. Present → Sekarang) dan pertahankan pemisahnya: \"Jun 2026 – Sekarang\". " +
      "Teks polos tanpa format markdown.\n\nARRAY:\n" + JSON.stringify(blocks);
    const out = await callGemini(prompt, key, model);
    if (out instanceof NextResponse) return out;
    const m = out.match(/\[[\s\S]*\]/);
    let arr: unknown = null;
    try {
      arr = m ? JSON.parse(m[0]) : null;
    } catch {
      arr = null;
    }
    if (!Array.isArray(arr) || arr.length !== blocks.length || arr.some((x) => typeof x !== "string")) {
      return NextResponse.json(
        { error: "Format jawaban AI tidak terduga. Coba lagi." },
        { status: 502 }
      );
    }
    return NextResponse.json({ result: (arr as string[]).map((x) => stripMarkdown(x.trim())) });
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
      "Tulis dalam teks polos: tanpa format markdown apa pun (tanpa **, *, _, #, atau backtick). " +
      "Jangan menambah, mengarang, atau menyimpulkan informasi yang tidak ada di dokumen. " +
      "Nama diri, nama merek, dan istilah asli harus disalin persis seperti tertulis; jangan diparafrasekan atau diganti padanannya.\n\nDOKUMEN:\n" + text;
  } else if (body.action === "translate") {
    const target = body.targetLang === "en" ? "bahasa Inggris" : "bahasa Indonesia";
    prompt =
      `Terjemahkan dokumen berikut ke ${target} dengan setia, pertahankan makna, istilah teknis, dan struktur per bagian. ` +
      "Tulis dalam teks polos: tanpa format markdown apa pun (tanpa **, *, _, #, atau backtick). " +
      "Pertahankan struktur baris, baris kosong antar bagian, dan poin-poin (tulis tiap poin sebagai baris yang diawali tanda minus) persis seperti dokumen asli. " +
      "Nama diri, nama merek, dan nama produk tetap seperti aslinya, jangan diterjemahkan. " +
      `Semua kalimat lain WAJIB diterjemahkan sepenuhnya ke ${target}; jangan biarkan satu pun kalimat atau paragraf utuh tetap dalam bahasa asal. ` +
      "Jangan menambahkan komentar apa pun selain hasil terjemahan.\n\nDOKUMEN:\n" + text;
  } else {
    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  }

  const out = await callGemini(prompt, key, model);
  if (out instanceof NextResponse) return out;
  const result = stripMarkdown(out);
  if (!result) {
    return NextResponse.json({ error: "AI tidak menghasilkan jawaban." }, { status: 502 });
  }
  return NextResponse.json({ result });
}
