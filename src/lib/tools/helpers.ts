/** Shared helpers for file tool processors (client-side only) */
import { err } from "./messages";

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Convert latin digits to Bengali digits (UI nicety) */
export function toBn(value: number | string): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

/** Trigger a browser download for a blob */
export function downloadBlob(blob: Blob, name: string): void {
  // Day 21: subtle confirmation buzz on every successful download
  import("@/lib/haptics").then((m) => m.haptic("light")).catch(() => {});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export function readText(file: File): Promise<string> {
  return file.text();
}

/** Remove extension from a filename */
export function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Sanitize a filename for download (keeps unicode letters) */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "file";
}

/** ArrayBuffer -> base64 (chunked to avoid stack overflow) */
export function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Load a bitmap from any raster image file (svg fallback via <img>) */
export async function loadImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Fallback (e.g. SVG): decode via <img>
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("imageLoadFail"));
        img.src = url;
      });
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }
}

export function drawToCanvas(
  src: ImageBitmap | HTMLImageElement,
  w: number,
  h: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(err("imageCreateFail"))),
      mime,
      quality
    );
  });
}

/** Parse "1-3,5,8" (1-based, inclusive) into a sorted unique array */
export function parsePageRanges(input: string, maxPage: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw err("rangeBad", part);
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (a > b) [a, b] = [b, a];
    for (let p = a; p <= b; p++) {
      if (p >= 1 && p <= maxPage) pages.add(p);
    }
  }
  if (pages.size === 0) throw err("noValidPages");
  return [...pages].sort((x, y) => x - y);
}
