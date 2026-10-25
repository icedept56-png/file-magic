/** PDF processors — pdf-lib + pdfjs-dist, all client-side */
import type { OutputFile, ToolOptions, ProgressFn } from "../types";
import { readArrayBuffer, stripExt, canvasToBlob, loadImageBitmap } from "../helpers";
import { err, pLabel } from "../messages";
import { runPdf, runPdfOnMain, PdfWorkerCrash } from "@/lib/workers/client";
import type { PdfOpPayload } from "@/lib/workers/pdf-core";

/** pdf-lib document type (the class has a private constructor → InstanceType is unusable) */
type PdfDoc = Awaited<ReturnType<(typeof import("pdf-lib").PDFDocument)["load"]>>;
void (0 as unknown as PdfDoc | null); // type-only keepalive (ops moved to the worker)

/** pdfjs PDFDocumentProxy type, resolved purely through type queries (no runtime import) */
type PdfJsDoc = Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>;

/** pdfjs-dist must be loaded lazily with the worker served from /public */
async function getPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // file exists in public/
  return pdfjs;
}

function pdfBlob(bytes: Uint8Array | ArrayBuffer): Blob {
  // pdf-lib yields Uint8Array<ArrayBufferLike>; BlobPart wants an explicit ArrayBuffer view
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

/* ─── Day 9: heavy pdf-lib ops run in the Web Worker ────────────────────
   runPdf transfers the buffers; if the WORKER ITSELF crashes (never a
   functional error), the files are re-read and the identical pdf-core
   implementation runs on the main thread — no behavior change, just
   less responsiveness. Functional errors (corrupt PDF, bad range) keep
   their localized messages because the worker only sends {key,args}. */

async function runPdfSafe(
  files: File[],
  build: (buffers: ArrayBuffer[]) => PdfOpPayload,
  onProgress: ProgressFn
): Promise<{ name: string; bytes: ArrayBuffer }[]> {
  const buffers = await Promise.all(files.map((f) => readArrayBuffer(f)));
  try {
    const { files: out } = await runPdf(build(buffers), onProgress);
    return out;
  } catch (e) {
    if (e instanceof PdfWorkerCrash) {
      const fresh = await Promise.all(files.map((f) => readArrayBuffer(f)));
      const { files: out } = await runPdfOnMain(build(fresh), onProgress);
      return out;
    }
    throw e;
  }
}

const toOutput = (out: { name: string; bytes: ArrayBuffer }[]): OutputFile[] =>
  out.map((f) => ({ name: f.name, blob: pdfBlob(f.bytes) }));

function loadFailError(): Error {
  return err("pdfLoadFail");
}

/* ─── 1. Merge ─────────────────────────────────────────────────────────── */

export async function mergePdf(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (files.length < 2) throw err("mergeNeed2");
  const out = await runPdfSafe(files, (buffers) => ({ op: "merge", buffers }), onProgress);
  onProgress(100, pLabel("pDone"));
  return toOutput(out);
}

/* ─── 2. Split ─────────────────────────────────────────────────────────── */

export async function splitPdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const mode = String(opts.mode || "range") === "each" ? "each" : "range";
  const pages = mode === "range" ? String(opts.pages ?? "") : "";
  if (mode === "range" && !pages.trim()) throw err("noValidPages");
  const base = stripExt(file.name);
  const out = await runPdfSafe(
    [file],
    (buffers) => ({ op: "split", buffer: buffers[0], mode, pages, base }),
    onProgress
  );
  onProgress(100, pLabel("pDone"));
  return toOutput(out);
}

/* ─── 3. Compress ──────────────────────────────────────────────────────── */

export async function compressPdf(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const base = stripExt(file.name);
  const out = await runPdfSafe(
    [file],
    (buffers) => ({ op: "compress", buffer: buffers[0], base }),
    onProgress
  );
  onProgress(100, pLabel("pDone"));
  return toOutput(out);
}

/* ─── 4. PDF → Images ──────────────────────────────────────────────────── */

export async function pdfToImages(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const format = opts.format === "jpeg" ? "jpeg" : "png";
  const quality = Math.min(100, Math.max(10, Number(opts.quality) || 90)) / 100;
  const scale = Math.min(3, Math.max(1, Number(opts.scale) || 2));

  const pdfjs = await getPdfjs();
  let doc: PdfJsDoc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await readArrayBuffer(file)) }).promise;
  } catch {
    throw loadFailError();
  }
  const numPages = doc.numPages;
  const base = stripExt(file.name);
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const ext = format === "jpeg" ? "jpg" : "png";

  const renderPage = async (pageNum: number): Promise<Blob> => {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw err("canvasFail");
    if (format === "jpeg") {
      // avoid transparent → black background in JPG
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
      throw err("pageRenderFail", pageNum);
    }
    page.cleanup();
    return canvasToBlob(canvas, mime, format === "jpeg" ? quality : undefined);
  };

  if (numPages === 1) {
    onProgress(60, pLabel("pRendering"));
    const blob = await renderPage(1);
    onProgress(100, pLabel("pDone"));
    return [{ name: `${base}.${ext}`, blob }];
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (let i = 0; i < numPages; i++) {
    onProgress(Math.min(92, Math.round(((i + 1) / numPages) * 90)), pLabel("pPage", i + 1, numPages));
    zip.file(`page-${i + 1}.${ext}`, await renderPage(i + 1));
  }
  onProgress(95, pLabel("pZipMaking"));
  const zipBlob: Blob = await zip.generateAsync<"blob">({ compression: "STORE" });
  onProgress(100, pLabel("pDone"));
  return [{ name: `${base}-pages.zip`, blob: zipBlob }];
}

/* ─── 5. Images → PDF ──────────────────────────────────────────────────── */

export async function imagesToPdf(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("needImage");
  const { jsPDF } = await import("jspdf");
  const PAGE_W = 794; // A4 in px (96 dpi)
  const PAGE_H = 1123;
  const MARGIN = 24;

  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 90) + 3, pLabel("pImage", i + 1, files.length));

    let bitmap: ImageBitmap | HTMLImageElement;
    try {
      bitmap = await loadImageBitmap(f);
    } catch {
      throw err("imageCorrupt", f.name);
    }
    const natW = "naturalWidth" in bitmap ? bitmap.naturalWidth || bitmap.width : bitmap.width;
    const natH = "naturalHeight" in bitmap ? bitmap.naturalHeight || bitmap.height : bitmap.height;
    if (!natW || !natH) throw err("imageCorrupt", f.name);

    const landscape = natW > natH;
    if (!pdf) {
      // hotfixes:["px_scaling"] — without it jsPDF's px unit uses a 96/72 scale and
      // the A4 page is only ~446×631 "px" units (content would overflow the page)
      pdf = new jsPDF({ unit: "px", format: "a4", compress: true, orientation: landscape ? "l" : "p", hotfixes: ["px_scaling"] });
    } else {
      pdf.addPage("a4", landscape ? "l" : "p");
    }

    const pageW = landscape ? PAGE_H : PAGE_W;
    const pageH = landscape ? PAGE_W : PAGE_H;
    const fit = Math.min((pageW - MARGIN * 2) / natW, (pageH - MARGIN * 2) / natH);
    const w = natW * fit;
    const h = natH * fit;
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;

    // draw to canvas first → JPEG data-url (white bg so transparency never turns black)
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(natW));
    canvas.height = Math.max(1, Math.round(natH));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw err("canvasFail");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(dataUrl, "JPEG", x, y, w, h);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  }

  onProgress(96, pLabel("pAssemblingPdf"));
  const blob = (pdf as InstanceType<typeof jsPDF>).output("blob");
  onProgress(100, pLabel("pDone"));
  return [{ name: "images.pdf", blob }];
}

/* ─── 6. Rotate ────────────────────────────────────────────────────────── */

export async function rotatePdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const angle = Number(opts.angle) || 90;
  const base = stripExt(file.name);
  const out = await runPdfSafe(
    [file],
    (buffers) => ({ op: "rotate", buffer: buffers[0], angle, base }),
    onProgress
  );
  onProgress(100, pLabel("pDone"));
  return toOutput(out);
}

/* ─── 7. Watermark ─────────────────────────────────────────────────────── */

export async function watermarkPdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const text = String(opts.text ?? "").trim() || "CONFIDENTIAL";
  const opacity = Math.min(60, Math.max(5, Number(opts.opacity) || 20));

  // render the text once on a transparent canvas (canvas text = full Bengali support) —
  // canvas stays on the main thread; the pdf-lib embed/draw/save runs in the worker
  onProgress(12, pLabel("pDrawingWatermark"));
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw err("canvasFail");
  ctx.translate(512, 128);
  ctx.rotate(-Math.PI / 9);
  // use the SAME font the app actually renders with — next/font registers a hashed family
  // name, so the literal 'Hind Siliguri' would silently fall back to a random system font
  const fontFamily =
    (typeof document !== "undefined"
      ? getComputedStyle(document.body).fontFamily.split(",")[0]
      : "") || "sans-serif";
  // shrink long text so it never clips outside the 1024px tile
  let fontSize = 88;
  const measure = (size: number) => {
    ctx.font = `bold ${size}px ${fontFamily}, sans-serif`;
    return ctx.measureText(text).width;
  };
  if (measure(fontSize) > 880) {
    fontSize = Math.max(26, Math.floor((88 * 880) / measure(88)));
    measure(fontSize);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // bake at full alpha — the real opacity is applied once via page.drawImage below
  ctx.fillStyle = "rgba(120,120,130,1)";
  ctx.fillText(text, 0, 0);
  const pngBlob = await canvasToBlob(canvas, "image/png");
  const png = await pngBlob.arrayBuffer();

  const base = stripExt(file.name);
  const out = await runPdfSafe(
    [file],
    (buffers) => ({ op: "watermark", buffer: buffers[0], png, opacity, base }),
    onProgress
  );
  onProgress(100, pLabel("pDone"));
  return toOutput(out);
}

/* ─── 8. Delete pages ──────────────────────────────────────────────────── */

export async function deletePdfPages(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const pagesInput = String(opts.pages ?? "").trim();
  if (!pagesInput) throw err("needPagesInput");
  const base = stripExt(file.name);
  const out = await runPdfSafe(
    [file],
    (buffers) => ({ op: "delete-pages", buffer: buffers[0], pages: pagesInput, base }),
    onProgress
  );
  onProgress(100, pLabel("pDone"));
  return toOutput(out);
}

/* ─── 9. Extract text ──────────────────────────────────────────────────── */

/** shared: pull the text of every page (Bengali-safe) */
async function extractPagesText(file: File, onProgress: ProgressFn): Promise<string[]> {
  const pdfjs = await getPdfjs();
  let doc: PdfJsDoc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await readArrayBuffer(file)) }).promise;
  } catch {
    throw loadFailError();
  }
  const numPages = doc.numPages;
  const pageTexts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    onProgress(Math.round(((i - 1) / numPages) * 88) + 4, pLabel("pPage", i, numPages));
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pageTexts.push(text);
    page.cleanup();
  }
  return pageTexts;
}

export async function extractPdfText(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const pageTexts = await extractPagesText(file, onProgress);
  const all = pageTexts.join("\n\n").trim();
  if (!all) throw err("pdfNoText");
  onProgress(100, pLabel("pDone"));
  return [
    { name: `${stripExt(file.name)}.txt`, blob: new Blob([all], { type: "text/plain;charset=utf-8" }) },
  ];
}

/* ─── 10. PDF → Word ───────────────────────────────────────────────────── */

export async function pdfToDocx(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw err("givePdf");
  const pageTexts = await extractPagesText(file, onProgress);
  const all = pageTexts.join("\n\n").trim();
  if (!all) throw err("pdfNoTextWord");
  onProgress(92, pLabel("pWordMaking"));
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const paragraphs = all
    .split(/\r?\n/)
    .flatMap((chunk) => chunk.split(/(?<=।|[.!?])\s+/))
    .filter((s) => s.trim().length > 0)
    .map((line) => new Paragraph({ children: [new TextRun(line.trim())] }));
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  onProgress(100, pLabel("pDone"));
  return [{ name: `${stripExt(file.name)}.docx`, blob }];
}
