import {
  GitCompareArrows,
  FilePenLine,
  Sparkles,
  Languages,
  FileImage,
  ScanLine,
  ImageDown,
  FileCode2,
  Merge,
  Split,
  RotateCw,
  LayoutGrid,
  Crop,
  Hash,
  Droplet,
  Minimize2,
  Clapperboard,
  type LucideIcon,
} from "lucide-react";

export type Tool = {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: "Analisis" | "Edit" | "Konversi ke PDF" | "Konversi dari PDF" | "Halaman" | "Video";
  ai?: boolean;
};

export const tools: Tool[] = [
  {
    slug: "bandingkan-pdf",
    title: "Bandingkan PDF",
    description:
      "Bandingkan dua versi PDF dan tandai teks yang ditambah, dihapus, atau diubah.",
    icon: GitCompareArrows,
    category: "Analisis",
  },
  {
    slug: "ringkas-pdf",
    title: "Ringkas PDF",
    description: "Buat ringkasan isi PDF dengan AI dan unduh hasilnya sebagai PDF.",
    icon: Sparkles,
    category: "Analisis",
    ai: true,
  },
  {
    slug: "terjemahkan-pdf",
    title: "Terjemahkan PDF",
    description:
      "Terjemahkan isi PDF antara bahasa Indonesia dan Inggris dengan AI, lalu unduh hasilnya sebagai PDF.",
    icon: Languages,
    category: "Analisis",
    ai: true,
  },
  {
    slug: "edit-pdf",
    title: "Edit PDF",
    description:
      "Tambahkan teks, highlight, coretan, bentuk, gambar, atau whiteout di atas PDF, lalu unduh hasilnya.",
    icon: FilePenLine,
    category: "Edit",
  },
  {
    slug: "gambar-ke-pdf",
    title: "Gambar ke PDF",
    description:
      "Gabungkan foto atau hasil scan (JPG, PNG, WebP, HEIC) menjadi satu PDF. Atur urutan, ukuran halaman, orientasi, margin, dan tata letak.",
    icon: FileImage,
    category: "Konversi ke PDF",
  },
  {
    slug: "scan-ke-pdf",
    title: "Scan ke PDF",
    description:
      "Ubah foto halaman kertas menjadi PDF yang rapi seperti hasil scanner.",
    icon: ScanLine,
    category: "Konversi ke PDF",
  },
  {
    slug: "pdf-ke-jpg",
    title: "PDF ke JPG",
    description: "Ubah setiap halaman PDF menjadi gambar JPG atau PNG.",
    icon: ImageDown,
    category: "Konversi dari PDF",
  },
  {
    slug: "pdf-ke-markdown",
    title: "PDF ke Markdown",
    description:
      "Ubah PDF menjadi berkas Markdown (.md) dengan struktur yang mirip.",
    icon: FileCode2,
    category: "Konversi dari PDF",
  },
  {
    slug: "gabung-pdf",
    title: "Gabung PDF",
    description:
      "Gabungkan beberapa berkas PDF menjadi satu dokumen sesuai urutan yang kamu tentukan.",
    icon: Merge,
    category: "Halaman",
  },
  {
    slug: "pisah-pdf",
    title: "Pisah PDF",
    description:
      "Pisahkan PDF berdasarkan rentang halaman, setiap N halaman, atau ekstrak halaman terpilih menjadi satu berkas.",
    icon: Split,
    category: "Halaman",
  },
  {
    slug: "putar-pdf",
    title: "Putar PDF",
    description:
      "Putar semua halaman atau halaman tertentu sebesar 90°, 180°, atau 270° tanpa mengubah isi halaman.",
    icon: RotateCw,
    category: "Halaman",
  },
  {
    slug: "atur-halaman-pdf",
    title: "Atur Halaman PDF",
    description:
      "Susun ulang, hapus, gandakan, atau sisipkan halaman kosong pada thumbnail halaman.",
    icon: LayoutGrid,
    category: "Halaman",
  },
  {
    slug: "crop-pdf",
    title: "Crop PDF",
    description:
      "Pilih area pada halaman lalu crop satu halaman atau semua halaman tanpa mengubah isinya.",
    icon: Crop,
    category: "Halaman",
  },
  {
    slug: "nomor-halaman",
    title: "Nomor Halaman",
    description:
      "Tambahkan nomor halaman dengan format, posisi, dan huruf pilihan ke semua halaman atau sebagian halaman.",
    icon: Hash,
    category: "Halaman",
  },
  {
    slug: "watermark-pdf",
    title: "Watermark PDF",
    description:
      "Tambahkan watermark teks atau gambar dengan posisi, ukuran, rotasi, dan transparansi pilihan ke semua halaman atau sebagian halaman.",
    icon: Droplet,
    category: "Halaman",
  },
  {
    slug: "kompres-video",
    title: "Kompres Video",
    description:
      "Kecilkan ukuran video (MP4, WebM, MOV) langsung di browser. Hasilnya MP4 yang bisa diputar di mana saja.",
    icon: Clapperboard,
    category: "Video",
  },
  {
    slug: "kompres-pdf",
    title: "Kompres PDF",
    description:
      "Kecilkan ukuran PDF dengan mengubah halaman menjadi gambar terkompresi. Teks hasilnya tidak bisa diseleksi.",
    icon: Minimize2,
    category: "Halaman",
  },
];

export const categories = [
  "Analisis",
  "Konversi ke PDF",
  "Konversi dari PDF",
  "Halaman",
  "Video",
] as const;
