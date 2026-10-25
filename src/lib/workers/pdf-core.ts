/* ═══════════════════════════════════════════════════════════════════════
   PDF core ops (pdf-lib) — Day 9 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Pain point: "৫০MB PDF-এ ব্রাউজার আটকে যায়"

   ONE pure implementation shared by two contexts:
     • the pdf-worker (off the main thread → UI stays responsive)
     • the main-thread fallback (workers unavailable / worker crashed)

   Everything here is DOM-free. Errors are thrown as FmError { key, args }
   (message-localization KEYS, not text) so the worker never needs the
   i18n store — the client side re-localizes via err()/pLabel().
   Progress reports are (pct, key, args) triples for the same reason.
   ═══════════════════════════════════════════════════════════════════════ */

export class FmError extends Error {
  key: string;
  args: (string | number)[];
  constructor(key: string, args: (string | number)[] = []) {
    super(key);
    this.key = key;
    this.args = args;
  }
}

export type CoreProgress = (pct: number, key: string, args?: (string | number)[]) => void;

export type PdfOpPayload =
  | { op: "merge"; buffers: ArrayBuffer[] }
  | { op: "split"; buffer: ArrayBuffer; mode: "range" | "each"; pages: string; base: string }
  | { op: "compress"; buffer: ArrayBuffer; base: string }
  | { op: "rotate"; buffer: ArrayBuffer; angle: number; base: string }
  | { op: "watermark"; buffer: ArrayBuffer; png: ArrayBuffer; opacity: number; base: string }
  | { op: "delete-pages"; buffer: ArrayBuffer; pages: string; base: string };

export type PdfOpResult = { files: { name: string; bytes: ArrayBuffer }[] };

/** parse "1-3,5" (1-based inclusive) — worker-safe twin of helpers.parsePageRanges */
function parseRangesRaw(input: string, maxPage: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new FmError("rangeBad", [part]);
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (a > b) [a, b] = [b, a];
    for (let p = a; p <= b; p++) {
      if (p >= 1 && p <= maxPage) pages.add(p);
    }
  }
  if (pages.size === 0) throw new FmError("noValidPages");
  return [...pages].sort((x, y) => x - y);
}

type PdfDoc = Awaited<ReturnType<(typeof import("pdf-lib").PDFDocument)["load"]>>;

async function load(bytes: ArrayBuffer): Promise<PdfDoc> {
  const { PDFDocument } = await import("pdf-lib");
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new FmError("pdfLoadFail");
  }
}

/* ── the ops ───────────────────────────────────────────────────────────── */

export async function runPdfOp(
  payload: PdfOpPayload,
  onProgress: CoreProgress
): Promise<PdfOpResult> {
  switch (payload.op) {
    case "merge": {
      const { PDFDocument } = await import("pdf-lib");
      const merged = await PDFDocument.create();
      const total = payload.buffers.length;
      for (let i = 0; i < total; i++) {
        onProgress(Math.round((i / total) * 90), "pFile", [i + 1, total]);
        const src = await load(payload.buffers[i]);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      onProgress(95, "pSaving");
      const bytes = await merged.save();
      return { files: [{ name: "merged.pdf", bytes: bytes.slice().buffer as ArrayBuffer }] };
    }

    case "split": {
      const src = await load(payload.buffer);
      const count = src.getPageCount();
      const { PDFDocument } = await import("pdf-lib");

      if (payload.mode === "each") {
        if (count > 200) throw new FmError("tooManyPages");
        const out: { name: string; bytes: ArrayBuffer }[] = [];
        for (let i = 0; i < count; i++) {
          onProgress(Math.round((i / count) * 95), "pPage", [i + 1, count]);
          const doc = await PDFDocument.create();
          const [page] = await doc.copyPages(src, [i]);
          doc.addPage(page);
          const bytes = await doc.save();
          out.push({ name: `page-${i + 1}.pdf`, bytes: bytes.slice().buffer as ArrayBuffer });
        }
        return { files: out };
      }

      const picked = parseRangesRaw(payload.pages, count);
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, picked.map((p) => p - 1));
      pages.forEach((p) => doc.addPage(p));
      onProgress(90, "pSaving");
      const bytes = await doc.save();
      return { files: [{ name: `${payload.base}-split.pdf`, bytes: bytes.slice().buffer as ArrayBuffer }] };
    }

    case "compress": {
      onProgress(30, "pOpening");
      const doc = await load(payload.buffer);
      onProgress(60, "pCompressing");
      const bytes = await doc.save({ useObjectStreams: true });
      // never hand back a file BIGGER than the original — keep the smaller one
      const original = new Uint8Array(payload.buffer);
      const final = bytes.length < original.length ? bytes : original;
      return { files: [{ name: `${payload.base}-compressed.pdf`, bytes: final.slice().buffer as ArrayBuffer }] };
    }

    case "rotate": {
      const { degrees } = await import("pdf-lib");
      onProgress(25, "pOpening");
      const doc = await load(payload.buffer);
      onProgress(55, "pRotating");
      doc.getPages().forEach((page) => {
        page.setRotation(degrees((page.getRotation().angle + payload.angle) % 360));
      });
      onProgress(85, "pSaving");
      const bytes = await doc.save();
      return { files: [{ name: `${payload.base}-rotated.pdf`, bytes: bytes.slice().buffer as ArrayBuffer }] };
    }

    case "watermark": {
      const { PDFDocument } = await import("pdf-lib");
      onProgress(40, "pOpening");
      const doc = await load(payload.buffer);
      const img = await doc.embedPng(new Uint8Array(payload.png));
      const pages = doc.getPages();
      const drawOpacity = Math.min(0.9, Math.max(0.08, payload.opacity / 100));
      pages.forEach((page, idx) => {
        const { width, height } = page.getSize();
        const w = width * 0.7;
        const h = w * (256 / 1024); // canvas aspect
        page.drawImage(img, {
          x: (width - w) / 2,
          y: (height - h) / 2,
          width: w,
          height: h,
          opacity: drawOpacity,
        });
        onProgress(Math.round((idx / pages.length) * 45) + 50, "pPage", [idx + 1, pages.length]);
      });
      onProgress(96, "pSaving");
      const bytes = await doc.save();
      return { files: [{ name: `${payload.base}-watermarked.pdf`, bytes: bytes.slice().buffer as ArrayBuffer }] };
    }

    case "delete-pages": {
      onProgress(20, "pOpening");
      const doc = await load(payload.buffer);
      const count = doc.getPageCount();
      const toDelete = parseRangesRaw(payload.pages, count);
      if (toDelete.length >= count) throw new FmError("cantDeleteAll");
      onProgress(50, "pDeletingPages");
      // remove in descending order so earlier indices stay valid
      [...toDelete].sort((a, b) => b - a).forEach((p) => doc.removePage(p - 1));
      onProgress(85, "pSaving");
      const bytes = await doc.save();
      return { files: [{ name: `${payload.base}-edited.pdf`, bytes: bytes.slice().buffer as ArrayBuffer }] };
    }
  }
}
