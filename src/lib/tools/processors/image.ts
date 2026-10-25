/** Image processors — pure Canvas API, all client-side */
import type { OutputFile, ToolOptions, ProgressFn } from "../types";
import { stripExt, loadImageBitmap, canvasToBlob } from "../helpers";
import { err, pLabel } from "../messages";
import { ensureDecoded } from "./formats";

type Src = ImageBitmap | HTMLImageElement;

/** Target encoding derived from the source mime type */
interface Target {
  mime: string;
  ext: string;
  quality?: number;
}

function imgSize(src: Src): { w: number; h: number } {
  if ("naturalWidth" in src) {
    return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  }
  return { w: src.width, h: src.height };
}

function closeBitmap(src: Src): void {
  if ("close" in src && typeof src.close === "function") src.close();
}

async function fileToBitmap(file: File): Promise<Src> {
  try {
    // Day 10: HEIC/HEIF (iPhone photos) are decoded via heic2any first
    const decoded = await ensureDecoded(file);
    return await loadImageBitmap(decoded);
  } catch (e) {
    // already-localized errors (heicFail) pass through untouched
    if ((e as { fmKey?: string })?.fmKey) throw e;
    throw err("imageCorrupt", file.name);
  }
}

/** Draw a bitmap onto a fresh canvas of the given size (optional white base) */
function drawTo(src: Src, w: number, h: number, whiteBase: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw err("canvasFail");
  if (whiteBase) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** jpeg → jpeg, webp → webp, png → png (keeps transparency), everything else → png */
function sameFormatTarget(file: File, quality?: number): Target {
  const m = (file.type || "").toLowerCase();
  if (m === "image/jpeg") return { mime: "image/jpeg", ext: "jpg", quality };
  if (m === "image/webp") return { mime: "image/webp", ext: "webp", quality };
  return { mime: "image/png", ext: "png" };
}

/* ─── 1. Convert ───────────────────────────────────────────────────────── */

export async function convertImage(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("needImage");
  const formatRaw = String(opts.format || "webp");
  const format = (["webp", "jpeg", "png"].includes(formatRaw) ? formatRaw : "webp") as
    | "webp"
    | "jpeg"
    | "png";
  const quality = Math.min(100, Math.max(10, Number(opts.quality) || 85)) / 100;
  const out: OutputFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 92) + 3, pLabel("pImage", i + 1, files.length));
    const bitmap = await fileToBitmap(f);
    const { w, h } = imgSize(bitmap);
    if (!w || !h) {
      closeBitmap(bitmap);
      throw err("imageCorrupt", f.name);
    }
    // JPEG output cannot hold transparency → paint white underneath
    const canvas = drawTo(bitmap, w, h, format === "jpeg");
    const blob = await canvasToBlob(
      canvas,
      `image/${format}`,
      format === "png" ? undefined : quality
    );
    closeBitmap(bitmap);
    out.push({ name: `${stripExt(f.name)}.${format === "jpeg" ? "jpg" : format}`, blob });
  }
  onProgress(100, pLabel("pDone"));
  return out;
}

/* ─── 2. Compress ──────────────────────────────────────────────────────── */

export async function compressImage(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("needImage");
  const quality = Math.min(95, Math.max(10, Number(opts.quality) || 75)) / 100;
  const out: OutputFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 92) + 3, pLabel("pImage", i + 1, files.length));
    const bitmap = await fileToBitmap(f);
    const { w, h } = imgSize(bitmap);
    if (!w || !h) {
      closeBitmap(bitmap);
      throw err("imageCorrupt", f.name);
    }
    // PNG has no quality knob → re-encode as WebP for real compression
    const srcMime = (f.type || "").toLowerCase();
    const target: Target =
      srcMime === "image/jpeg"
        ? { mime: "image/jpeg", ext: "jpg", quality }
        : srcMime === "image/webp"
          ? { mime: "image/webp", ext: "webp", quality }
          : { mime: "image/webp", ext: "webp", quality };

    const canvas = drawTo(bitmap, w, h, false);
    const blob = await canvasToBlob(canvas, target.mime, target.quality);
    closeBitmap(bitmap);
    out.push({ name: `${stripExt(f.name)}.${target.ext}`, blob });
  }
  onProgress(100, pLabel("pDone"));
  return out;
}

/* ─── 3. Resize ────────────────────────────────────────────────────────── */

export async function resizeImage(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("needImage");
  const inW = Number(opts.width) || 0;
  const inH = Number(opts.height) || 0;
  if (!inW && !inH) throw err("needWidthOrHeight");
  const keepAspect = opts.keepAspect !== false && opts.keepAspect !== "false";
  const out: OutputFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 92) + 3, pLabel("pImage", i + 1, files.length));
    const bitmap = await fileToBitmap(f);
    const natW = imgSize(bitmap);
    if (!natW.w || !natW.h) {
      closeBitmap(bitmap);
      throw err("imageCorrupt", f.name);
    }

    let tW: number;
    let tH: number;
    if (inW && inH) {
      if (keepAspect) {
        const scale = Math.min(inW / natW.w, inH / natW.h);
        tW = Math.max(1, Math.round(natW.w * scale));
        tH = Math.max(1, Math.round(natW.h * scale));
      } else {
        tW = inW;
        tH = inH;
      }
    } else if (inW) {
      tW = inW;
      tH = Math.max(1, Math.round((natW.h * inW) / natW.w));
    } else {
      tH = inH;
      tW = Math.max(1, Math.round((natW.w * inH) / natW.h));
    }

    const target = sameFormatTarget(f, 0.92); // png stays png → transparency survives
    const canvas = drawTo(bitmap, tW, tH, target.mime === "image/jpeg");
    const blob = await canvasToBlob(canvas, target.mime, target.quality);
    closeBitmap(bitmap);
    out.push({ name: `${stripExt(f.name)}.${target.ext}`, blob });
  }
  onProgress(100, pLabel("pDone"));
  return out;
}

/* ─── 4. Rotate / Flip ─────────────────────────────────────────────────── */

export async function rotateFlipImage(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("needImage");
  const rotate = Number(opts.rotate) || 0;
  const rot = (((Math.round(rotate / 90) * 90) % 360) + 360) % 360; // snap to 0/90/180/270
  const flipH = opts.flipH === true || opts.flipH === "true";
  const flipV = opts.flipV === true || opts.flipV === "true";
  const out: OutputFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 92) + 3, pLabel("pImage", i + 1, files.length));
    const bitmap = await fileToBitmap(f);
    const size = imgSize(bitmap);
    const natW = size.w;
    const natH = size.h;
    if (!natW || !natH) {
      closeBitmap(bitmap);
      throw err("imageCorrupt", f.name);
    }
    const target = sameFormatTarget(f, 0.92);
    const swap = rot === 90 || rot === 270;
    const cw = swap ? natH : natW;
    const ch = swap ? natW : natH;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, cw);
    canvas.height = Math.max(1, ch);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw err("canvasFail");
    if (target.mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(bitmap as CanvasImageSource, -natW / 2, -natH / 2, natW, natH);
    ctx.restore();

    const blob = await canvasToBlob(canvas, target.mime, target.quality);
    closeBitmap(bitmap);
    out.push({ name: `${stripExt(f.name)}.${target.ext}`, blob });
  }
  onProgress(100, pLabel("pDone"));
  return out;
}

/* ─── 5. Watermark ─────────────────────────────────────────────────────── */

export async function watermarkImage(
  files: File[],
  opts: ToolOptions,
  onProgress: ProgressFn
): Promise<OutputFile[]> {
  if (!files.length) throw err("needImage");
  const text = String(opts.wmText ?? "").trim();
  if (!text) throw err("needImage");
  const opacity = Math.min(100, Math.max(5, Number(opts.wmOpacity) || 30)) / 100;
  const scalePct = Math.min(20, Math.max(2, Number(opts.wmScale) || 6)) / 100;
  const posRaw = String(opts.wmPosition || "center");
  const diagonal = posRaw === "diagonal";
  const color = "rgba(255, 255, 255, {o})";
  const shadow = "rgba(0, 0, 0, {o})";
  const out: OutputFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(Math.round((i / files.length) * 92) + 3, pLabel("pImage", i + 1, files.length));
    const bitmap = await fileToBitmap(f);
    const { w, h } = imgSize(bitmap);
    if (!w || !h) {
      closeBitmap(bitmap);
      throw err("imageCorrupt", f.name);
    }
    const target = sameFormatTarget(f, 0.92);
    const canvas = drawTo(bitmap, w, h, target.mime === "image/jpeg");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw err("canvasFail");

    const fontSize = Math.max(14, Math.round(Math.min(w, h) * scalePct * 0.6));
    ctx.font = `600 ${fontSize}px sans-serif`;
    const metrics = ctx.measureText(text);
    const tw = metrics.width;
    const th = fontSize;

    const drawMark = (x: number, y: number, o: number) => {
      ctx.save();
      ctx.globalAlpha = o;
      ctx.fillStyle = color.replace("{o}", "1");
      ctx.shadowColor = shadow.replace("{o}", "1");
      ctx.shadowBlur = Math.max(2, fontSize * 0.12);
      if (diagonal) {
        const angle = -Math.atan2(h, w);
        ctx.translate(w / 2, h / 2);
        ctx.rotate(angle);
        ctx.fillText(text, -tw / 2, th / 3);
      } else {
        ctx.fillText(text, x, y);
      }
      ctx.restore();
    };

    const o = opacity;
    const pad = Math.round(fontSize * 0.8);
    if (diagonal) {
      drawMark(0, 0, o);
    } else if (posRaw === "center") {
      drawMark((w - tw) / 2, (h + th * 0.35) / 2, o);
    } else if (posRaw === "top-left") {
      drawMark(pad, pad + th * 0.8, o);
    } else if (posRaw === "top-right") {
      drawMark(w - tw - pad, pad + th * 0.8, o);
    } else if (posRaw === "bottom-left") {
      drawMark(pad, h - pad, o);
    } else {
      drawMark(w - tw - pad, h - pad, o);
    }

    const blob = await canvasToBlob(canvas, target.mime, target.quality);
    closeBitmap(bitmap);
    out.push({ name: `${stripExt(f.name)}-watermark.${target.ext}`, blob });
  }
  onProgress(100, pLabel("pDone"));
  return out;
}
