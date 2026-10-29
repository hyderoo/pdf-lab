import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://pdflab.web.id";
  return [""].map((u) => ({ url: `${base}${u}` }));
}
