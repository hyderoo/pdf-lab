# PDF Lab - PDF tools for the Undip community

**Live: https://pdflab-undip.vercel.app**

A collection of PDF tools that run **entirely in your browser** - files are processed on your device and never uploaded to a server. Built by an Undip alumnus, for Undip students, staff, and alumni.

## Why it's different

Most PDF sites upload your documents to their servers. PDF Lab does everything client-side with [pdf-lib](https://pdf-lib.js.org/) and [pdf.js](https://mozilla.github.io/pdf.js/): your thesis, KRS, and transcripts never leave your device. The only exception: the two AI tools send extracted **text** (never the original file) to Google Gemini, and only after you confirm.

## Tools

**Analysis**
- Compare PDF - sentence-level diff of two PDF versions
- Summarize PDF (AI) - Gemini-powered summary, downloadable as PDF
- Translate PDF (AI) - Indonesian ↔ English, downloadable as PDF

**Convert to PDF**
- Images to PDF - JPG/PNG/WebP/HEIC, ordering, A4/fit sizing, margins
- Scan to PDF - cleanup photos of paper (contrast stretch, whitened background)

**Convert from PDF**
- PDF to JPG/PNG - every page rendered to images, downloaded as ZIP
- PDF to Markdown - text extraction to `.md`

**Pages**
- Merge, Split (ranges / every page / extract), Rotate (90/180/270, all or selected)
- Arrange pages - reorder, delete, duplicate, insert blank pages via thumbnails
- Crop - draw an area, apply to one or all pages
- Page numbers - format, position, starting number, page range
- Watermark - text or image, opacity, rotation
- Compress - rasterize pages to compressed JPEG (honest trade-off: text no longer selectable)

## Access

Sign-in is restricted to Undip email domains, enforced **server-side** in the Auth.js `signIn` callback:

| Domain | Who | Provider |
| --- | --- | --- |
| `student.undip.ac.id` | Students (Google Workspace) | Google |
| `undip.ac.id`, `live.undip.ac.id` | Lecturers & staff | Google |
| `students.undip.ac.id` | Student SSO accounts | Microsoft |
| `alumni.undip.ac.id` | Alumni | Microsoft |

No database. Sessions are stateless JWTs; the server stores nothing about you or your files.

## Stack

Next.js 16 (App Router, Turbopack, Cache Components) · TypeScript · Tailwind CSS 4 · pdf-lib · pdfjs-dist · Auth.js v5 (Google + Microsoft Entra ID) · Gemini API (server-side proxy for AI tools)

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

Required env vars:

- `AUTH_SECRET` - `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` - Google Cloud → APIs & Services → Credentials → OAuth client (Web). Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`
- `AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_MICROSOFT_ENTRA_ID_SECRET` - Entra → App registrations (accounts in any org directory). Redirect URI (Web): `https://<your-domain>/api/auth/callback/microsoft-entra-id`
- `GEMINI_API_KEY` *(optional, enables AI tools)* - free key from [Google AI Studio](https://aistudio.google.com/apikey). The key stays server-side in `/api/ai`. Free-tier quotas apply (shown in AI Studio); on exhaustion the tools return a friendly "try again later".
- `GEMINI_MODEL` *(optional)* - defaults to `gemini-3.5-flash-lite`
- `EXTRA_ALLOWED_EMAILS` *(optional, owner/testing allowlist)* - comma-separated exact emails allowed to sign in on top of the Undip domains, e.g. `someone@gmail.com, other@gmail.com`. Matching is case-insensitive and exact (no domains). Undip domain rules are unchanged for everyone else; leave unset in normal use.

## License

MIT © 2026 Hafiz Hamdani
