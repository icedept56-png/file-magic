/** PDF processors — pdf-lib + pdfjs-dist, all client-side */
import type { OutputFile, ToolOptions, ProgressFn } from "../types";
import { readArrayBuffer, stripExt, parsePageRanges, canvasToBlob, loadImageBitmap } from "../helpers";

/** pdf-lib document type (the class has a private constructor → InstanceType is unusable) */
type PdfDoc = Awaited<ReturnType<(typeof import("pdf-lib").PDFDocument)["load"]>>;

/** pdfjs PDFDocumentProxy type, resolved purely through type queries (no runtime import) */
type PdfJsDoc = Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>;

/** pdfjs-dist must be loaded lazily with the worker served from /public */
async function getPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // file exists in public/
  return pdfjs;
}

function pdfBlob(bytes: Uint8Array): Blob {
  // pdf-lib yields Uint8Array<ArrayBufferLike>; BlobPart wants an explicit ArrayBuffer view
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

function loadFailError(): Error {
  return new Error("পিডিএফটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত বা পাসওয়ার্ড-সুরক্ষিত হতে পারে");
}

/* ─── 1. Merge ─────────────────────────────────────────────────────────── */

export async function mergePdf(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (files.length < 2) throw new Error("মার্জ করতে কমপক্ষে ২টি পিডিএফ দিন");
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    onProgress(Math.round((i / files.length) * 90), `ফাইল ${i + 1}/${files.length}`);
    try {
      const src = await PDFDocument.load(await readArrayBuffer(files[i]), {
        ignoreEncryption: true,
      });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch {
      throw new Error(
        "একটি পিডিএফ পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত বা পাসওয়ার্ড-সুরক্ষিত হতে পারে"
      );
    }
  }
  onProgress(95, "সেভ হচ্ছে...");
  const bytes = await merged.save();
  onProgress(100, "সম্পন্ন");
  return [{ name: "merged.pdf", blob: pdfBlob(bytes) }];
}

/* ─── 2. Split ─────────────────────────────────────────────────────────── */

export async function splitPdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw new Error("একটি পিডিএফ দিন");
  const mode = String(opts.mode || "range");
  const { PDFDocument } = await import("pdf-lib");

  let src: PdfDoc;
  try {
    src = await PDFDocument.load(await readArrayBuffer(file), { ignoreEncryption: true });
  } catch {
    throw loadFailError();
  }
  const count = src.getPageCount();
  const base = stripExt(file.name);

  if (mode === "each") {
    if (count > 200) throw new Error("পেজ সংখ্যা অনেক বেশি — ২০০-এর কম পেজের পিডিএফ দিন");
    const out: OutputFile[] = [];
    for (let i = 0; i < count; i++) {
      onProgress(Math.round((i / count) * 95), `পেজ ${i + 1}/${count}`);
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [i]);
      doc.addPage(page);
      out.push({ name: `page-${i + 1}.pdf`, blob: pdfBlob(await doc.save()) });
    }
    onProgress(100, "সম্পন্ন");
    return out;
  }

  // range mode
  const picked = parsePageRanges(String(opts.pages ?? ""), count);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, picked.map((p) => p - 1));
  pages.forEach((p) => doc.addPage(p));
  onProgress(90, "সেভ হচ্ছে...");
  const bytes = await doc.save();
  onProgress(100, "সম্পন্ন");
  return [{ name: `${base}-split.pdf`, blob: pdfBlob(bytes) }];
}

/* ─── 3. Compress ──────────────────────────────────────────────────────── */

export async function compressPdf(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw new Error("একটি পিডিএফ দিন");
  const { PDFDocument } = await import("pdf-lib");
  onProgress(30, "খোলা হচ্ছে...");
  let doc: PdfDoc;
  try {
    doc = await PDFDocument.load(await readArrayBuffer(file), { ignoreEncryption: true });
  } catch {
    throw loadFailError();
  }
  onProgress(60, "কম্প্রেস হচ্ছে...");
  const bytes = await doc.save({ useObjectStreams: true });
  onProgress(100, "সম্পন্ন");
  return [{ name: `${stripExt(file.name)}-compressed.pdf`, blob: pdfBlob(bytes) }];
}

/* ─── 4. PDF → Images ──────────────────────────────────────────────────── */

export async function pdfToImages(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw new Error("একটি পিডিএফ দিন");
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
    if (!ctx) throw new Error("ক্যানভাস তৈরি করা যায়নি");
    if (format === "jpeg") {
      // avoid transparent → black background in JPG
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
      throw new Error(`পেজ ${pageNum} রেন্ডার করা যায়নি — পিডিএফটি ক্ষতিগ্রস্ত হতে পারে`);
    }
    page.cleanup();
    return canvasToBlob(canvas, mime, format === "jpeg" ? quality : undefined);
  };

  if (numPages === 1) {
    onProgress(60, "রেন্ডার হচ্ছে...");
    const blob = await renderPage(1);
    onProgress(100, "সম্পন্ন");
    return [{ name: `${base}.${ext}`, blob }];
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (let i = 0; i < numPages; i++) {
    onProgress(Math.min(92, Math.round(((i + 1) / numPages) * 90)), `পেজ ${i + 1}/${numPages}`);
    zip.file(`page-${i + 1}.${ext}`, await renderPage(i + 1));
  }
  onProgress(95, "ZIP বানানো হচ্ছে...");
  const zipBlob: Blob = await zip.generateAsync<"blob">({ compression: "STORE" });
  onProgress(100, "সম্পন্ন");
  return [{ name: `${base}-pages.zip`, blob: zipBlob }];
}

/* ─── 5. Images → PDF ──────────────────────────────────────────────────── */

export async function imagesToPdf(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw new Error("অন্তত একটি ছবি দিন");
  const { jsPDF } = await import("jspdf");
  const PAGE_W = 794; // A4 in px (96 dpi)
  const PAGE_H = 1123;
  const MARGIN = 24;

  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 90) + 3, `ছবি ${i + 1}/${files.length}`);

    let bitmap: ImageBitmap | HTMLImageElement;
    try {
      bitmap = await loadImageBitmap(f);
    } catch {
      throw new Error(`"${f.name}" ছবিটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে`);
    }
    const natW = "naturalWidth" in bitmap ? bitmap.naturalWidth || bitmap.width : bitmap.width;
    const natH = "naturalHeight" in bitmap ? bitmap.naturalHeight || bitmap.height : bitmap.height;
    if (!natW || !natH) throw new Error(`"${f.name}" ছবিটি পড়া যায়নি — ফাইলটি ক্ষতিগ্রস্ত হতে পারে`);

    const landscape = natW > natH;
    if (!pdf) {
      pdf = new jsPDF({ unit: "px", format: "a4", compress: true, orientation: landscape ? "l" : "p" });
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
    if (!ctx) throw new Error("ক্যানভাস তৈরি করা যায়নি");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(dataUrl, "JPEG", x, y, w, h);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  }

  onProgress(96, "পিডিএফ সাজানো হচ্ছে...");
  const blob = (pdf as InstanceType<typeof jsPDF>).output("blob");
  onProgress(100, "সম্পন্ন");
  return [{ name: "images.pdf", blob }];
}

/* ─── 6. Rotate ────────────────────────────────────────────────────────── */

export async function rotatePdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw new Error("একটি পিডিএফ দিন");
  const angle = Number(opts.angle) || 90;
  const { PDFDocument, degrees } = await import("pdf-lib");
  onProgress(25, "খোলা হচ্ছে...");
  let doc: PdfDoc;
  try {
    doc = await PDFDocument.load(await readArrayBuffer(file), { ignoreEncryption: true });
  } catch {
    throw loadFailError();
  }
  onProgress(55, "ঘোরানো হচ্ছে...");
  doc.getPages().forEach((page) => {
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  onProgress(85, "সেভ হচ্ছে...");
  const bytes = await doc.save();
  onProgress(100, "সম্পন্ন");
  return [{ name: `${stripExt(file.name)}-rotated.pdf`, blob: pdfBlob(bytes) }];
}

/* ─── 7. Watermark ─────────────────────────────────────────────────────── */

export async function watermarkPdf(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw new Error("একটি পিডিএফ দিন");
  const text = String(opts.text ?? "").trim() || "CONFIDENTIAL";
  const opacity = Math.min(60, Math.max(5, Number(opts.opacity) || 20));

  // render the text once on a transparent canvas (canvas text = full Bengali support)
  onProgress(12, "ওয়াটারমার্ক আঁকা হচ্ছে...");
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ক্যানভাস তৈরি করা যায়নি");
  ctx.translate(512, 128);
  ctx.rotate(-Math.PI / 9);
  ctx.font = "bold 88px 'Hind Siliguri', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(120,120,130,${opacity / 100})`;
  ctx.fillText(text, 0, 0);
  const pngBlob = await canvasToBlob(canvas, "image/png");
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

  const { PDFDocument } = await import("pdf-lib");
  onProgress(40, "খোলা হচ্ছে...");
  let doc: PdfDoc;
  try {
    doc = await PDFDocument.load(await readArrayBuffer(file), { ignoreEncryption: true });
  } catch {
    throw loadFailError();
  }
  const img = await doc.embedPng(pngBytes);
  const pages = doc.getPages();
  const drawOpacity = Math.min(0.9, opacity / 100 + 0.15);
  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();
    const w = width * 0.7;
    const h = w * (256 / 1024); // keep canvas aspect
    page.drawImage(img, {
      x: (width - w) / 2,
      y: (height - h) / 2,
      width: w,
      height: h,
      opacity: drawOpacity,
    });
    onProgress(Math.round((idx / pages.length) * 45) + 50, `পেজ ${idx + 1}/${pages.length}`);
  });
  onProgress(96, "সেভ হচ্ছে...");
  const bytes = await doc.save();
  onProgress(100, "সম্পন্ন");
  return [{ name: `${stripExt(file.name)}-watermarked.pdf`, blob: pdfBlob(bytes) }];
}

/* ─── 8. Delete pages ──────────────────────────────────────────────────── */

export async function deletePdfPages(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw new Error("একটি পিডিএফ দিন");
  const pagesInput = String(opts.pages ?? "").trim();
  if (!pagesInput) throw new Error("কোন কোন পেজ মুছবেন লিখুন (যেমন: 2,4-6)");
  const { PDFDocument } = await import("pdf-lib");
  onProgress(20, "খোলা হচ্ছে...");
  let doc: PdfDoc;
  try {
    doc = await PDFDocument.load(await readArrayBuffer(file), { ignoreEncryption: true });
  } catch {
    throw loadFailError();
  }
  const count = doc.getPageCount();
  const toDelete = parsePageRanges(pagesInput, count);
  if (toDelete.length >= count) {
    throw new Error("সব পেজ মুছে ফেলা যাবে না — অন্তত একটি পেজ থাকতে হবে");
  }
  onProgress(50, "পেজ মুছে ফেলা হচ্ছে...");
  // remove in descending order so earlier indices stay valid
  [...toDelete].sort((a, b) => b - a).forEach((p) => doc.removePage(p - 1));
  onProgress(85, "সেভ হচ্ছে...");
  const bytes = await doc.save();
  onProgress(100, "সম্পন্ন");
  return [{ name: `${stripExt(file.name)}-edited.pdf`, blob: pdfBlob(bytes) }];
}

/* ─── 9. Extract text ──────────────────────────────────────────────────── */

export async function extractPdfText(
  files: File[],
  _opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  const file = files[0];
  if (!file) throw new Error("একটি পিডিএফ দিন");
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
    onProgress(Math.round(((i - 1) / numPages) * 88) + 4, `পেজ ${i}/${numPages}`);
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
  const all = pageTexts.join("\n\n").trim();
  if (!all) {
    throw new Error("এই পিডিএফে কোনো টেক্সট পাওয়া যায়নি — সম্ভবত এটি স্ক্যান করা ছবি");
  }
  onProgress(100, "সম্পন্ন");
  return [
    { name: `${stripExt(file.name)}.txt`, blob: new Blob([all], { type: "text/plain;charset=utf-8" }) },
  ];
}
