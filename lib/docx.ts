import JSZip from "jszip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// remove characters XML 1.0 forbids
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");

export function buildDocx(pages: string[]): Promise<Blob> {
  const paras: string[] = [];
  pages.forEach((page, pi) => {
    const lines = page.split("\n");
    lines.forEach((line, li) => {
      const t = clean(line).trim();
      if (!t) return;
      const bullet = /^[-*]\s+/.test(t);
      const body = bullet ? t.replace(/^[-*]\s+/, "") : t;
      const br = pi > 0 && li === lines.findIndex((l) => l.trim()) ? '<w:r><w:br w:type="page"/></w:r>' : "";
      const ppr = bullet ? '<w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>' : '<w:pPr><w:spacing w:after="120"/></w:pPr>';
      paras.push(`<w:p>${ppr}${br}<w:r><w:t xml:space="preserve">${bullet ? "\u2022 " : ""}${esc(body)}</w:t></w:r></w:p>`);
    });
  });
  if (paras.length === 0) paras.push("<w:p/>");
  const doc =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file("word/document.xml", doc);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

