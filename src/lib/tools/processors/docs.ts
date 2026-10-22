/** Document processors — mammoth, docx, marked, html2canvas-pro + jspdf */
import type { OutputFile, ToolOptions, ProgressFn } from "../types";
import { readArrayBuffer, readText, stripExt } from "../helpers";

/* ─── Private helpers ──────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wrap a body fragment into a standalone, nicely styled HTML document */
function wrapHtmlDoc(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 800px; margin: 40px auto; padding: 0 24px; background: #ffffff; color: #1f2937;
         font-family: 'Hind Siliguri', 'Noto Sans Bengali', system-ui, sans-serif; line-height: 1.75; }
  h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 0.5em; line-height: 1.35; color: #111827; }
  h1 { font-size: 2em; } h2 { font-size: 1.6em; } h3 { font-size: 1.3em; }
  h4 { font-size: 1.15em; } h5 { font-size: 1em; } h6 { font-size: 0.9em; }
  p { margin: 0.6em 0; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
  th { background: #f3f4f6; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em;
         font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #f3f4f6; padding: 14px 16px; border-radius: 8px; overflow-x: auto; line-height: 1.5; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: 4px 16px; border-left: 4px solid #d1d5db;
               background: #f9fafb; color: #4b5563; }
  a { color: #7c3aed; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 2em 0; }
  ul, ol { padding-left: 1.6em; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** Render an HTML fragment to a paginated A4 PDF blob (Bengali fonts supported) */
async function htmlToPdfBlob(html: string, onProgress: ProgressFn): Promise<Blob> {
  // 1. create offscreen container
  const el = document.createElement("div");
  el.setAttribute(
    "style",
    "position:fixed;left:-20000px;top:0;width:794px;background:#ffffff;color:#111827;" +
      "padding:48px;font-family:var(--font-bengali),'Hind Siliguri','Noto Sans Bengali',system-ui,sans-serif;" +
      "font-size:15px;line-height:1.75;word-wrap:break-word;overflow-wrap:break-word;"
  );
  el.innerHTML = html;
  document.body.appendChild(el);

  // 2. html2canvas-pro
  let canvas: HTMLCanvasElement;
  try {
    const html2canvas = (await import("html2canvas-pro")).default;
    await new Promise((r) => setTimeout(r, 60)); // let layout settle
    canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });
  } catch {
    throw new Error("পিডিএফ রেন্ডার করা যায়নি — ডকুমেন্টটি খুব বড় বা অস্বাভাবিক হতে পারে");
  } finally {
    document.body.removeChild(el);
  }

  // 3. slice into A4 pages (794x1123 css px → 1588x2246 at scale 2)
  const { jsPDF } = await import("jspdf");
  const PAGE_H = Math.round(1123 * 2);
  const totalPages = Math.max(1, Math.ceil(canvas.height / PAGE_H));
  if (totalPages > 80) {
    throw new Error("ডকুমেন্টটি অনেক বড় — ৮০ পেজের বেশি বানানো যাচ্ছে না");
  }
  // hotfixes:["px_scaling"] is REQUIRED — without it jsPDF's px unit uses a 96/72
  // scale, making the A4 page only ~446×631 "px" units and clipping all content
  const pdf = new jsPDF({ unit: "px", format: "a4", compress: true, hotfixes: ["px_scaling"] });
  for (let i = 0; i < totalPages; i++) {
    if (i > 0) pdf.addPage("a4", "p");
    const sliceH = Math.min(PAGE_H, canvas.height - i * PAGE_H);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceH;
    const sctx = slice.getContext("2d");
    if (!sctx) throw new Error("ক্যানভাস তৈরি করা যায়নি");
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, slice.width, slice.height);
    sctx.drawImage(canvas, 0, i * PAGE_H, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    // sliceH/2 converts device px back to css px (scale 2)
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 794, sliceH / 2);
    onProgress(Math.round(((i + 1) / totalPages) * 90) + 5, `পেজ ${i + 1}/${totalPages}`);
  }
  return pdf.output("blob");
}

/* ─── 1. DOCX → PDF ────────────────────────────────────────────────────── */

export async function docxToPdf(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw new Error("অন্তত একটি Word (.docx) ফাইল দিন");
  const out: OutputFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 88), `ফাইল ${i + 1}/${files.length}`);
    let html: string;
    try {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await readArrayBuffer(f) });
      html = value;
    } catch {
      throw new Error(`"${f.name}" খোলা যায়নি — এটি কি সঠিক .docx ফাইল?`);
    }
    const blob = await htmlToPdfBlob(html, onProgress);
    out.push({ name: `${stripExt(f.name)}.pdf`, blob });
  }
  onProgress(100, "সম্পন্ন");
  return out;
}

/* ─── 2. DOCX → HTML ───────────────────────────────────────────────────── */

export async function docxToHtml(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw new Error("অন্তত একটি Word (.docx) ফাইল দিন");
  const out: OutputFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 85) + 5, `ফাইল ${i + 1}/${files.length}`);
    let html: string;
    try {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await readArrayBuffer(f) });
      html = value;
    } catch {
      throw new Error(`"${f.name}" খোলা যায়নি — এটি কি সঠিক .docx ফাইল?`);
    }
    const doc = wrapHtmlDoc(html, stripExt(f.name));
    out.push({
      name: `${stripExt(f.name)}.html`,
      blob: new Blob([doc], { type: "text/html;charset=utf-8" }),
    });
  }
  onProgress(100, "সম্পন্ন");
  return out;
}

/* ─── 3. DOCX → Text ───────────────────────────────────────────────────── */

export async function docxToText(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw new Error("অন্তত একটি Word (.docx) ফাইল দিন");
  const out: OutputFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 85) + 5, `ফাইল ${i + 1}/${files.length}`);
    let text: string;
    try {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ arrayBuffer: await readArrayBuffer(f) });
      text = value;
    } catch {
      throw new Error(`"${f.name}" খোলা যায়নি — এটি কি সঠিক .docx ফাইল?`);
    }
    out.push({
      name: `${stripExt(f.name)}.txt`,
      blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
    });
  }
  onProgress(100, "সম্পন্ন");
  return out;
}

/* ─── 4. Text → PDF ────────────────────────────────────────────────────── */

export async function textToPdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const text = files.length ? await readText(files[0]) : String(opts.text ?? "");
  if (!text.trim()) throw new Error("আগে কিছু লিখুন অথবা .txt ফাইল দিন");
  // html2canvas does NOT soft-wrap white-space:pre-wrap text (long lines get
  // clipped) — so emit real flowing paragraphs instead; runs of 2+ spaces are
  // preserved with &nbsp; and each newline becomes its own paragraph
  const html = text
    .split(/\r?\n/)
    .map((line) => {
      const safe = escapeHtml(line).replace(/ {2,}/g, (m) => "&nbsp;".repeat(m.length));
      return `<p style="margin:0">${safe || "&nbsp;"}</p>`;
    })
    .join("");
  const blob = await htmlToPdfBlob(html, onProgress);
  onProgress(100, "সম্পন্ন");
  return [{ name: "document.pdf", blob }];
}

/* ─── 5. Text → DOCX ───────────────────────────────────────────────────── */

export async function textToDocx(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const text = files.length ? await readText(files[0]) : String(opts.text ?? "");
  if (!text.trim()) throw new Error("আগে কিছু লিখুন অথবা .txt ফাইল দিন");
  onProgress(20, "ডকুমেন্ট তৈরি হচ্ছে...");
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => new Paragraph({ children: [new TextRun(line)] }));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  onProgress(100, "সম্পন্ন");
  return [{ name: "document.docx", blob }];
}

/* ─── 6. Markdown → HTML ───────────────────────────────────────────────── */

export async function markdownToHtml(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const text = files.length ? await readText(files[0]) : String(opts.text ?? "");
  if (!text.trim()) throw new Error("মার্কডাউন লিখুন বা .md ফাইল দিন");
  onProgress(30, "মার্কডাউন প্রসেস হচ্ছে...");
  const { marked } = await import("marked");
  const body = await marked.parse(text);
  const base = files[0] ? stripExt(files[0].name) : "document";
  const doc = wrapHtmlDoc(body, base);
  onProgress(100, "সম্পন্ন");
  return [{ name: `${base}.html`, blob: new Blob([doc], { type: "text/html;charset=utf-8" }) }];
}

/* ─── 7. HTML → PDF ────────────────────────────────────────────────────── */

export async function htmlToPdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const html = files.length ? await readText(files[0]) : String(opts.text ?? "");
  if (!html.trim()) throw new Error("HTML কোড লিখুন অথবা .html ফাইল দিন");
  // strip scripts AND inline event handlers — rendering them would be unsafe inside the PDF snapshot
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  const blob = await htmlToPdfBlob(clean, onProgress);
  onProgress(100, "সম্পন্ন");
  return [{ name: "document.pdf", blob }];
}
