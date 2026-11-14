/* PDF text extraction for the "跟课学" materials. pdfjs-dist is the only
   optional dependency in the project: the server still boots without it, and
   a missing library degrades to a plain "paste the text" message. */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CMAPS = join(ROOT, "node_modules", "pdfjs-dist", "cmaps") + "/";
const FONTS = join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + "/";

const MAX_PAGES = 80;

let cached = null;
async function loadPdfjs() {
  if (cached) return cached;
  try {
    cached = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    const err = new Error("NO_PDF_LIB");
    err.userMessage = "这个环境没有安装 PDF 解析库（npm install pdfjs-dist）。也可以把 PDF 里的文字复制出来，直接粘贴。";
    throw err;
  }
  return cached;
}

export async function extractPdfText(data) {
  const pdfjs = await loadPdfjs();

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      cMapUrl: CMAPS,
      cMapPacked: true,
      standardFontDataUrl: FONTS,
    }).promise;
  } catch (e) {
    const err = new Error("PDF_OPEN_FAILED");
    if (String(e?.name).includes("Password")) err.userMessage = "这个 PDF 有密码，先解开再上传。";
    else err.userMessage = "这个 PDF 打不开（可能已损坏）。换一份，或把文字复制出来粘贴。";
    throw err;
  }

  const pages = Math.min(doc.numPages, MAX_PAGES);
  const parts = [];
  try {
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        line += item.str;
        if (item.hasEOL) {
          parts.push(line.trimEnd());
          line = "";
        }
      }
      if (line.trim()) parts.push(line.trimEnd());
      parts.push(""); // page break becomes a blank line
      page.cleanup?.();
    }
  } finally {
    doc.destroy?.().catch?.(() => {});
  }

  const text = parts
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.replace(/\s/g, "").length < 20) {
    const err = new Error("PDF_NO_TEXT");
    err.userMessage = "这个 PDF 里没有可复制的文字（可能是扫描件或纯图片），请把文字复制出来粘贴。";
    throw err;
  }

  return { pages: doc.numPages, text };
}
