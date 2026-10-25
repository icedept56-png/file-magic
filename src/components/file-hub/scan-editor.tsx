"use client";

/* ═══════════════════════════════════════════════════════════════════════
   Document Scanner — Day 1 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Phone photos → clean scans. 100% client-side, zero uploads.

   Pipeline per page:
     base canvas (photo downscaled ≤2000px)
       → rotate (0/90/180/270)
       → CSS-filter draw (brightness/contrast/grayscale/saturate)
       → single pixel pass: auto-levels LUT (2–98 percentile stretch)
          + Otsu threshold for Black & White preset
   Exports:
     PDF  — multi-page A4 (portrait/landscape by aspect), JPEG 0.92 via pdf-lib
     JPG  — one JPEG per page (ZIP when more than one)

   UX: zero learning cost — drop photos, pick a scan style, download.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Images,
  Loader2,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanLine,
  ScanText,
  Trash2,
  Undo2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import { useEditorHistory, useUndoRedoKeys } from "@/lib/use-history";
import { downloadBlob, safeName, stripExt } from "@/lib/tools/helpers";
import { useAppStore } from "@/store/app-store";

/* ── types & constants ─────────────────────────────────────────────────── */

type Preset = "color" | "gray" | "bw" | "magic";
type Rot = 0 | 90 | 180 | 270;
type Page = { id: string; base: HTMLCanvasElement; rot: Rot; name: string };
type Settings = { preset: Preset; brightness: number; contrast: number; auto: boolean };

const MAX_DIM = 2000; // longest edge kept for output quality (~240 dpi on A4)
const SAMPLE_W = 640; // histogram sample width for LUT + Otsu
const THUMB = 180; // thumbnail longest edge
const DEBOUNCE_MS = 130;

const ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.bmp";

const PRESETS: { key: Preset; label: "scanPresetColor" | "scanPresetGray" | "scanPresetBw" | "scanPresetMagic" }[] = [
  { key: "color", label: "scanPresetColor" },
  { key: "gray", label: "scanPresetGray" },
  { key: "bw", label: "scanPresetBw" },
  { key: "magic", label: "scanPresetMagic" },
];

const DEFAULT_SETTINGS: Settings = { preset: "magic", brightness: 0, contrast: 0, auto: true };

const uid = () => Math.random().toString(36).slice(2, 10);

/* ── image math (module-level, no hooks) ───────────────────────────────── */

/** downscale/rotate a canvas so its longest edge is ≤ maxDim */
function fitCanvas(src: HTMLCanvasElement, rot: Rot, maxDim: number): HTMLCanvasElement {
  const swap = rot === 90 || rot === 270;
  const sw = src.width;
  const sh = src.height;
  const scale = Math.min(1, maxDim / (swap ? Math.max(sw, sh) : Math.max(sw, sh)));
  const w = Math.max(1, Math.round((swap ? sh : sw) * scale));
  const h = Math.max(1, Math.round((swap ? sw : sh) * scale));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.translate(w / 2, h / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  return out;
}

/** percentile auto-levels LUT measured on a low-res grayscale sample */
function autoLut(c: HTMLCanvasElement): Uint8ClampedArray | null {
  const s = fitCanvas(c, 0, SAMPLE_W);
  const d = s.getContext("2d")!.getImageData(0, 0, s.width, s.height).data;
  const hist = new Uint32Array(256);
  const total = s.width * s.height;
  for (let i = 0; i < d.length; i += 4) {
    hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  }
  let acc = 0;
  let low = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.02) {
      low = v;
      break;
    }
  }
  acc = 0;
  let high = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.98) {
      high = v;
      break;
    }
  }
  if (high - low < 24) return null; // already well exposed
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(((v - low) / (high - low)) * 255);
  return lut;
}

/** Otsu threshold from a 256-bin histogram */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = v;
    }
  }
  return thr;
}

/** grayscale histogram of a canvas (low-res sample, LUT applied if given) */
function grayHist(c: HTMLCanvasElement, lut: Uint8ClampedArray | null) {
  const s = fitCanvas(c, 0, SAMPLE_W);
  const d = s.getContext("2d")!.getImageData(0, 0, s.width, s.height).data;
  const hist = new Uint32Array(256);
  const total = s.width * s.height;
  for (let i = 0; i < d.length; i += 4) {
    let g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    if (lut) g = lut[g];
    hist[g]++;
  }
  return { hist, total };
}

/** the full per-page pipeline: rotate → filter draw → auto-levels → optional Otsu B&W */
function processPage(base: HTMLCanvasElement, rot: Rot, st: Settings, maxDim: number): HTMLCanvasElement {
  const work = fitCanvas(base, rot, maxDim);
  const out = document.createElement("canvas");
  out.width = work.width;
  out.height = work.height;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;

  const parts: string[] = [];
  if (st.auto) {
    parts.push(`brightness(${100 + st.brightness + 8}%)`, `contrast(${100 + st.contrast + 10}%)`);
  } else {
    parts.push(`brightness(${100 + st.brightness}%)`, `contrast(${100 + st.contrast}%)`);
  }
  if (st.preset === "gray" || st.preset === "bw") parts.push("grayscale(100%)");
  if (st.preset === "magic") parts.push("saturate(135%)");
  ctx.filter = parts.join(" ");
  ctx.drawImage(work, 0, 0);
  ctx.filter = "none";

  const wantsLut = st.auto;
  const wantsBw = st.preset === "bw";
  if (!wantsLut && !wantsBw) return out;

  const lut = wantsLut ? autoLut(out) : null;
  let thr: number | null = null;
  if (wantsBw) {
    const { hist, total } = grayHist(out, lut);
    thr = otsu(hist, total);
  }

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (lut) {
      r = lut[r];
      g = lut[g];
      b = lut[b];
    }
    if (thr !== null) {
      const v = r * 0.299 + g * 0.587 + b * 0.114 >= thr ? 255 : 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    } else {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function canvasToBlob(c: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("canvas encode failed"))), "image/jpeg", quality),
  );
}

/* ── component ─────────────────────────────────────────────────────────── */

export function ScanEditor() {
  const { t, num, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);
  const openTool = useAppStore((s) => s.openTool);
  const setOcrHandoff = useAppStore((s) => s.setOcrHandoff);

  /* document state */
  const pagesHist = useEditorHistory<Page[]>([]);
  const pages = pagesHist.state;
  /** page mutations go through history — rotate/move/delete/add are undo points */
  const setPages = pagesHist.set;
  // unified undo/redo (Day 7)
  useUndoRedoKeys(pagesHist);
  const [cur, setCur] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [thumbs, setThumbs] = useState<{ id: string; url: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<null | "pdf" | "jpg">(null);
  const [dragOver, setDragOver] = useState(false);

  /* refs */
  const fileCamRef = useRef<HTMLInputElement>(null);
  const filePickRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const page = pages[cur] ?? null;

  /* ── loading photos ────────────────────────────────────────────────── */

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        toast.error(t("scanNotImage"));
        return;
      }
      setLoading(true);
      const added: Page[] = [];
      let skipped = 0;
      for (const f of files) {
        try {
          let bmp: ImageBitmap;
          try {
            bmp = await createImageBitmap(f, { imageOrientation: "from-image" } as ImageBitmapOptions);
          } catch {
            bmp = await createImageBitmap(f); // older engines: no EXIF option
          }
          const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
          const base = document.createElement("canvas");
          base.width = Math.round(bmp.width * scale);
          base.height = Math.round(bmp.height * scale);
          base.getContext("2d")!.drawImage(bmp, 0, 0, base.width, base.height);
          bmp.close();
          added.push({ id: uid(), base, rot: 0, name: f.name });
        } catch {
          skipped++;
        }
      }
      if (added.length) {
        pagesHist.set((p) => {
          const next = [...p, ...added];
          setCur(p.length); // select first newly added page
          return next;
        });
        toast.success(`${t("scanPageN")} ${added.length}`);
      }
      if (skipped) toast.warning(t("scanSomeSkipped"));
      setLoading(false);
    },
    [t],
  );

  /* ── preview rendering ─────────────────────────────────────────────── */

  const redraw = useCallback(() => {
    const disp = displayRef.current;
    if (!disp || !page) return;
    const st = settingsRef.current;
    const out = processPage(page.base, page.rot, st, MAX_DIM);
    disp.width = out.width;
    disp.height = out.height;
    disp.getContext("2d")!.drawImage(out, 0, 0);
  }, [page]);

  /* redraw immediately on page/rotation change; debounce on slider moves */
  useEffect(() => {
    if (!page) return;
    redraw();
  }, [page?.id, page?.rot, cur]);

  useEffect(() => {
    if (!page) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(redraw, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [settings, page, redraw]);

  /* thumbnails (processed look, small & fast) */
  useEffect(() => {
    if (!pages.length) {
      setThumbs([]);
      return;
    }
    let alive = true;
    const st = settingsRef.current;
    (async () => {
      const urls: { id: string; url: string }[] = [];
      for (const p of pages) {
        const c = processPage(p.base, p.rot, st, THUMB);
        urls.push({ id: p.id, url: c.toDataURL("image/jpeg", 0.75) });
      }
      if (alive) setThumbs(urls);
    })();
    return () => {
      alive = false;
    };
  }, [pages, settings.preset, settings.auto, settings.brightness, settings.contrast]);

  /* ── page ops ──────────────────────────────────────────────────────── */

  const rotate = (dir: -1 | 1) => {
    setPages((ps) =>
      ps.map((p, i) => (i === cur ? { ...p, rot: (((p.rot + dir * 90) % 360 + 360) % 360) as Rot } : p)),
    );
  };

  const move = (dir: -1 | 1) => {
    setPages((ps) => {
      const j = cur + dir;
      if (j < 0 || j >= ps.length) return ps;
      const next = [...ps];
      [next[cur], next[j]] = [next[j], next[cur]];
      setCur(j);
      return next;
    });
  };

  const removePage = () => {
    setPages((ps) => {
      const next = ps.filter((_, i) => i !== cur);
      setCur((c) => Math.max(0, Math.min(c, next.length - 1)));
      return next;
    });
  };

  /* hand the processed pages to the OCR studio (Day 2 integration) */
  const sendToOcr = async () => {
    if (!pages.length) return;
    const files: File[] = [];
    for (const p of pages) {
      const c = processPage(p.base, p.rot, settingsRef.current, MAX_DIM);
      const blob = await canvasToBlob(c, 0.92);
      files.push(
        new File([blob], `${stripExt(safeName(p.name)) || "scan"}-p${files.length + 1}.jpg`, { type: "image/jpeg" }),
      );
    }
    setOcrHandoff(files);
    openTool("ocr-studio");
  };

  /* ── exports ───────────────────────────────────────────────────────── */

  const baseName = () => stripExt(safeName(pages[0]?.name || "scan")) || "scan";

  const exportPdf = async () => {
    if (!pages.length) {
      toast.error(t("scanNeedPage"));
      return;
    }
    setExporting("pdf");
    try {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      doc.setProducer("File Magic — ফাইল ম্যাজিক");
      doc.setCreator("File Magic Document Scanner");
      for (const p of pages) {
        const c = processPage(p.base, p.rot, settingsRef.current, MAX_DIM);
        const blob = await canvasToBlob(c);
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        // portrait photo → portrait A4, landscape photo → landscape A4
        const [pw, ph] = img.width >= img.height ? [841.89, 595.28] : [595.28, 841.89];
        const margin = 18;
        const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const pg = doc.addPage([pw, ph]);
        pg.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      }
      const bytes = await doc.save();
      downloadBlob(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), `${baseName()}-scan.pdf`);
      toast.success(t("scanDone"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("scanNeedPage"));
    } finally {
      setExporting(null);
    }
  };

  const exportJpg = async () => {
    if (!pages.length) {
      toast.error(t("scanNeedPage"));
      return;
    }
    setExporting("jpg");
    try {
      const blobs: Blob[] = [];
      for (const p of pages) {
        const c = processPage(p.base, p.rot, settingsRef.current, MAX_DIM);
        blobs.push(await canvasToBlob(c, 0.9));
      }
      if (blobs.length === 1) {
        downloadBlob(blobs[0], `${baseName()}-scan.jpg`);
      } else {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        blobs.forEach((b, i) => zip.file(`${baseName()}-p${i + 1}.jpg`, b));
        downloadBlob(await zip.generateAsync({ type: "blob" }), `${baseName()}-scan-jpg.zip`);
      }
      toast.success(t("scanDone"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("scanNeedPage"));
    } finally {
      setExporting(null);
    }
  };

  /* ── derived ───────────────────────────────────────────────────────── */

  const busy = loading || exporting !== null;
  const sliderDisabled = busy;

  /* ── empty state ───────────────────────────────────────────────────── */

  if (!pages.length) {
    return (
      <div className="flex min-h-screen flex-col" lang={lang}>
        <header className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={goHome} aria-label={t("brandName")} className="h-11 w-11">
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-lg font-bold">
              <ScanLine className="h-5 w-5 text-emerald-400" aria-hidden />
              {t("scanTitle")}
            </h1>
            <p className="truncate text-xs text-muted-foreground">{t("scanTagline")}</p>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-emerald-400 bg-emerald-500/10" : "border-white/15 bg-white/[0.03]"
            }`}
          >
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
              {loading ? (
                <Loader2 className="h-9 w-9 animate-spin text-white" aria-hidden />
              ) : (
                <UploadCloud className="h-9 w-9 text-white" aria-hidden />
              )}
            </div>
            <div>
              <p className="text-base font-semibold">{loading ? t("scanProcessing") : t("scanEmpty")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("scanEmptyHint")}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                disabled={loading}
                onClick={() => fileCamRef.current?.click()}
                className="h-12 bg-gradient-to-r from-emerald-500 to-teal-600 px-6 font-semibold text-white shadow-emerald-500/30 hover:from-emerald-400 hover:to-teal-500"
              >
                <Camera className="mr-2 h-5 w-5" aria-hidden />
                {t("scanEmpty")}
              </Button>
              <Button variant="outline" size="lg" disabled={loading} onClick={() => filePickRef.current?.click()} className="h-12 px-6">
                <Images className="mr-2 h-5 w-5" aria-hidden />
                {t("scanAddMore")}
              </Button>
            </div>
          </motion.div>
        </main>

        <FooterNote lang={lang} />

        {/* hidden inputs — camera (environment) + gallery */}
        <input
          ref={fileCamRef}
          type="file"
          accept={ACCEPT}
          capture="environment"
          multiple
          className="sr-only"
          aria-label={t("scanAddAria")}
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={filePickRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-label={t("scanAddAria")}
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  /* ── editor ────────────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-screen flex-col" lang={lang}>
      {/* header */}
      <header className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
        <Button variant="ghost" size="icon" onClick={goHome} aria-label={t("brandName")} className="h-11 w-11 shrink-0">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-base font-bold sm:text-lg">
            <ScanLine className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            {t("scanTitle")}
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              {t("scanPages")} {num(cur + 1)}/{num(pages.length)}
            </span>
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">{t("scanTagline")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void exportPdf()}
            className="h-11 bg-gradient-to-r from-emerald-500 to-teal-600 px-4 font-semibold text-white shadow-emerald-500/25 hover:from-emerald-400 hover:to-teal-500"
          >
            {exporting === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="mr-2 h-4 w-4" aria-hidden />}
            {exporting === "pdf" ? t("scanExporting") : t("scanPdf")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportJpg()} className="h-11 px-4">
            {exporting === "jpg" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />}
            {t("scanJpg")}
          </Button>
        </div>
      </header>

      {/* main */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-3 pb-4 sm:px-4 lg:flex-row">
        {/* preview */}
        <section
          className="relative flex min-h-[46vh] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[repeating-conic-gradient(#1a1a24_0%_25%,#14141c_0%_50%)] bg-[length:24px_24px] lg:min-h-0"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
          aria-label={t("scanTitle")}
        >
          {page && (
            <canvas
              ref={displayRef}
              className="max-h-[46vh] max-w-full rounded-lg object-contain shadow-2xl shadow-black/50 lg:max-h-[62vh]"
              role="img"
              aria-label={`${t("scanPageN")} ${num(cur + 1)}`}
            />
          )}
          {/* page nudge buttons (touch friendly) */}
          {pages.length > 1 && (
            <>
              <button
                type="button"
                disabled={cur === 0 || busy}
                onClick={() => setCur((c) => Math.max(0, c - 1))}
                aria-label={`${t("scanPageAria")} −1`}
                className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75 disabled:opacity-25"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden />
              </button>
              <button
                type="button"
                disabled={cur === pages.length - 1 || busy}
                onClick={() => setCur((c) => Math.min(pages.length - 1, c + 1))}
                aria-label={`${t("scanPageAria")} +1`}
                className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75 disabled:opacity-25"
              >
                <ChevronRight className="h-6 w-6" aria-hidden />
              </button>
            </>
          )}
        </section>

        {/* controls */}
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <Label className="text-sm font-semibold">{t("scanPreset")}</Label>
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("scanPreset")}>
              {PRESETS.map((p) => {
                const active = settings.preset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={busy}
                    onClick={() => setSettings((s) => ({ ...s, preset: p.key }))}
                    className={`h-11 rounded-xl border text-sm font-semibold transition ${
                      active
                        ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-700 shadow-[0_0_0_1px_rgba(52,211,153,0.4)] dark:text-emerald-300"
                        : "border-white/10 bg-white/[0.04] text-foreground/80 hover:bg-white/[0.08]"
                    }`}
                  >
                    {t(p.label)}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="scan-auto" className="text-sm font-semibold">
                  {t("scanAuto")}
                </Label>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t("scanAutoDesc")}</p>
              </div>
              <Switch
                id="scan-auto"
                checked={settings.auto}
                disabled={busy}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, auto: v }))}
              />
            </div>

            <div className={`mt-4 space-y-4 ${settings.auto ? "opacity-50" : ""}`}>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label htmlFor="scan-bright" className="text-sm">
                    {t("scanBrightness")}
                  </Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{num(settings.brightness > 0 ? `+${settings.brightness}` : settings.brightness)}</span>
                </div>
                <Slider
                  id="scan-bright"
                  value={[settings.brightness]}
                  min={-60}
                  max={60}
                  step={1}
                  disabled={sliderDisabled || settings.auto}
                  onValueChange={([v]) => setSettings((s) => ({ ...s, brightness: v }))}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label htmlFor="scan-contrast" className="text-sm">
                    {t("scanContrast")}
                  </Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{num(settings.contrast > 0 ? `+${settings.contrast}` : settings.contrast)}</span>
                </div>
                <Slider
                  id="scan-contrast"
                  value={[settings.contrast]}
                  min={-60}
                  max={60}
                  step={1}
                  disabled={sliderDisabled || settings.auto}
                  onValueChange={([v]) => setSettings((s) => ({ ...s, contrast: v }))}
                />
              </div>
            </div>
          </div>

          {/* page actions */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <Label className="text-sm font-semibold">
              {t("scanPageN")} {num(cur + 1)}
            </Label>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Button variant="outline" size="icon" disabled={busy || !pagesHist.canUndo} onClick={pagesHist.undo} aria-label={t("urUndo")} title={`${t("urUndo")} (Ctrl+Z)`} className="h-11 w-full">
                <Undo2 className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" size="icon" disabled={busy || !pagesHist.canRedo} onClick={pagesHist.redo} aria-label={t("urRedo")} title={`${t("urRedo")} (Ctrl+Shift+Z)`} className="h-11 w-full">
                <Redo2 className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" size="icon" disabled={busy} onClick={() => rotate(-1)} aria-label={t("scanRotateL")} className="h-11 w-full">
                <RotateCcw className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" size="icon" disabled={busy} onClick={() => rotate(1)} aria-label={t("scanRotateR")} className="h-11 w-full">
                <RotateCw className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" size="icon" disabled={busy || cur === 0} onClick={() => move(-1)} aria-label={`${t("scanPageAria")} −`} className="h-11 w-full">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={busy || cur === pages.length - 1}
                onClick={() => move(1)}
                aria-label={`${t("scanPageAria")} +`}
                className="h-11 w-full"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={removePage}
              className="mt-2 h-11 w-full text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden />
              {t("scanDelete")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void sendToOcr()}
              className="mt-2 h-11 w-full"
            >
              <ScanText className="mr-2 h-4 w-4" aria-hidden />
              {t("scanOcr")}
            </Button>
          </div>
        </aside>
      </main>

      {/* thumbnails strip */}
      <div className="sticky bottom-0 border-t border-white/10 bg-[#0b0b12]/95 px-3 py-3 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto pb-1">
          {thumbs.map((th, i) => (
            <button
              key={th.id}
              type="button"
              onClick={() => setCur(i)}
              aria-label={`${t("scanPageAria")} ${num(i + 1)}`}
              aria-current={i === cur}
              className={`relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition sm:h-20 sm:w-14 ${
                i === cur ? "border-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.35)]" : "border-white/15 opacity-70 hover:opacity-100"
              }`}
            >
              <img src={th.url} alt={`${t("scanPageN")} ${num(i + 1)}`} className="h-full w-full object-cover" />
              <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/70 px-1 text-[10px] font-semibold text-white">
                {num(i + 1)}
              </span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => thumbInputRef.current?.click()}
            aria-label={t("scanAddAria")}
            className="grid h-16 w-12 shrink-0 place-items-center rounded-lg border-2 border-dashed border-white/20 text-muted-foreground transition hover:border-emerald-400/60 hover:text-emerald-300 sm:h-20 sm:w-14"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      <input
        ref={thumbInputRef}
        type="file"
        accept={ACCEPT}
        capture="environment"
        multiple
        className="sr-only"
        aria-label={t("scanAddAria")}
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ── small shared bits ─────────────────────────────────────────────────── */

function ArrowLeftIcon() {
  // local SVG keeps the editor self-contained (no extra lucide import drift)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function FooterNote({ lang }: { lang: string }) {
  const { t } = useT();
  return (
    <p className="mt-auto px-4 pb-6 text-center text-xs text-muted-foreground" lang={lang}>
      {t("footerLine")}
    </p>
  );
}
