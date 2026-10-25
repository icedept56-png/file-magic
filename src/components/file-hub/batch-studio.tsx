"use client";

/* ═══════════════════════════════════════════════════════════════════════
   Batch Studio — Day 3 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Many images → one action → per-file status → single ZIP download.
   Pain point: "২০টা ছবি কম্প্রেস করতে ২০ বার করতে হয়"

   Pipeline (100% client-side):
     files → jobs (≤60, images only, EXIF-safe decode, 96px thumbs)
     per job (sequential, fault-isolated):
       decode → canvas op (compress / convert / resize / rotate / grayscale)
              → encode (JPEG/WebP quality knob, PNG lossless) → bitmap closed
     one corrupt file fails alone — the rest of the batch survives;
     failed files can be retried without re-running the whole batch.

   Results → per-file download / one-click ZIP (JSZip, name-collision-safe).
   The generic workspace already offers "Download all (ZIP)" for any
   multi-output tool; this studio adds the missing per-file queue,
   fault isolation and retry for true bulk work.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  ArrowLeft,
  Check,
  CircleAlert,
  Clock,
  Contrast,
  Download,
  ImageIcon,
  Layers,
  Loader2,
  Minimize2,
  Repeat,
  RotateCcw,
  RotateCw,
  Scaling,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/lib/i18n";
import { downloadBlob, formatBytes, safeName, stripExt } from "@/lib/tools/helpers";
import { err } from "@/lib/tools/messages";
import { useAppStore } from "@/store/app-store";

/* ── constants & types ─────────────────────────────────────────────────── */

const ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif";
const IMG_EXT = /\.(png|jpe?g|webp|bmp|gif)$/i;
const MAX_FILES = 60;
const THUMB = 96;
const THUMB_CONCURRENCY = 8;

type Op = "compress" | "convert" | "resize" | "rotate" | "grayscale";
type Format = "jpeg" | "png" | "webp";
type JobStatus = "queued" | "running" | "done" | "failed";
type Phase = "idle" | "running" | "done";

type Job = {
  id: string;
  file: File;
  /** tiny object-URL preview ("" → icon fallback) */
  thumb: string;
  status: JobStatus;
  outName: string;
  outBlob: Blob | null;
  error: string;
};

type Settings = {
  quality: number; // compress quality %
  format: Format; // convert target
  maxEdge: number; // resize longest edge (px)
  rot: 90 | 180 | 270; // rotate angle
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ── canvas helpers ────────────────────────────────────────────────────── */

async function bitmapFrom(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    return await createImageBitmap(file);
  }
}

function canvasOf(w: number, h: number, white: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas-fail");
  if (white) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

function encode(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode-fail"))), mime, quality)
  );
}

/** keep a sensible output format (PNG keeps transparency, others re-encode) */
function keepTarget(file: File): { mime: string; ext: string } {
  const m = (file.type || "").toLowerCase();
  if (m === "image/jpeg") return { mime: "image/jpeg", ext: "jpg" };
  if (m === "image/webp") return { mime: "image/webp", ext: "webp" };
  return { mime: "image/png", ext: "png" };
}

/** tiny preview so a 60-photo list never decodes full-size images repeatedly */
async function makeThumb(file: File): Promise<string> {
  try {
    const bmp = await bitmapFrom(file);
    const scale = Math.min(1, THUMB / Math.max(bmp.width, bmp.height));
    const c = canvasOf(bmp.width * scale, bmp.height * scale, false);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise<string>((res) =>
      c.toBlob((b) => res(b ? URL.createObjectURL(b) : ""), "image/jpeg", 0.7)
    );
  } catch {
    return "";
  }
}

/** apply the batch operation to one file → output blob (throws localized errors) */
async function processFile(
  file: File,
  op: Op,
  st: Settings
): Promise<{ blob: Blob; ext: string }> {
  let bmp: ImageBitmap;
  try {
    bmp = await bitmapFrom(file);
  } catch {
    throw err("imageCorrupt", file.name);
  }
  const w = bmp.width;
  const h = bmp.height;
  try {
    if (!w || !h) throw err("imageCorrupt", file.name);

    let target = keepTarget(file);
    let canvas = canvasOf(w, h, false);

    switch (op) {
      case "compress": {
        const src = (file.type || "").toLowerCase();
        // PNG has no quality knob → re-encode as WebP for real savings
        target =
          src === "image/jpeg"
            ? { mime: "image/jpeg", ext: "jpg" }
            : { mime: "image/webp", ext: "webp" };
        canvas = canvasOf(w, h, false);
        canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
        break;
      }
      case "convert": {
        target =
          st.format === "jpeg"
            ? { mime: "image/jpeg", ext: "jpg" }
            : st.format === "png"
              ? { mime: "image/png", ext: "png" }
              : { mime: "image/webp", ext: "webp" };
        // JPEG cannot hold transparency → paint white underneath
        canvas = canvasOf(w, h, target.mime === "image/jpeg");
        canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
        break;
      }
      case "resize": {
        const edge = Math.min(8000, Math.max(64, st.maxEdge || 1600));
        const scale = Math.min(1, edge / Math.max(w, h)); // never upscale
        target = keepTarget(file);
        canvas = canvasOf(w * scale, h * scale, target.mime === "image/jpeg");
        canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        break;
      }
      case "rotate": {
        const swap = st.rot === 90 || st.rot === 270;
        target = keepTarget(file);
        canvas = canvasOf(swap ? h : w, swap ? w : h, target.mime === "image/jpeg");
        const ctx = canvas.getContext("2d")!;
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((st.rot * Math.PI) / 180);
        ctx.drawImage(bmp, -w / 2, -h / 2);
        ctx.restore();
        break;
      }
      case "grayscale": {
        target = keepTarget(file);
        canvas = canvasOf(w, h, target.mime === "image/jpeg");
        const ctx = canvas.getContext("2d")!;
        ctx.filter = "grayscale(1)";
        ctx.drawImage(bmp, 0, 0, w, h);
        ctx.filter = "none";
        break;
      }
    }

    const quality =
      op === "compress" ? Math.min(95, Math.max(10, st.quality)) / 100 : 0.92;
    const blob = await encode(
      canvas,
      target.mime,
      target.mime === "image/png" ? undefined : quality
    );
    return { blob, ext: target.ext };
  } finally {
    bmp.close();
  }
}

/* ── component ─────────────────────────────────────────────────────────── */

export function BatchStudio() {
  const { t, num, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [finished, setFinished] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [zipping, setZipping] = useState(false);
  const [dragging, setDragging] = useState(false);

  // operation + settings
  const [op, setOp] = useState<Op>("compress");
  const [quality, setQuality] = useState(75);
  const [format, setFormat] = useState<Format>("webp");
  const [maxEdge, setMaxEdge] = useState(1600);
  const [rot, setRot] = useState<90 | 180 | 270>(90);

  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const cancelRef = useRef(false);
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;
  const cfgRef = useRef({ op, quality, format, maxEdge, rot });
  cfgRef.current = { op, quality, format, maxEdge, rot };

  const busy = phase === "running";

  // revoke thumbnails when the studio unmounts
  useEffect(
    () => () => {
      for (const j of jobsRef.current) if (j.thumb) URL.revokeObjectURL(j.thumb);
    },
    []
  );

  // a dropped file outside the dropzone must never navigate the browser away
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  /* ── intake ──────────────────────────────────────────────────────────── */

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    const imgs = arr.filter(
      (f) => (f.type || "").startsWith("image/") || IMG_EXT.test(f.name)
    );
    const skipped = arr.length - imgs.length;
    if (skipped > 0) toast.warning(`${num(skipped)} ${t("bsSkipped")}`);
    if (imgs.length === 0) return;

    const room = MAX_FILES - jobsRef.current.length;
    let taken = imgs;
    if (imgs.length > room) {
      taken = imgs.slice(0, Math.max(0, room));
      toast.warning(t("bsTooMany"));
    }
    if (taken.length === 0) return;

    const base: Job[] = taken.map((f) => ({
      id: uid(),
      file: f,
      thumb: "",
      status: "queued",
      outName: "",
      outBlob: null,
      error: "",
    }));
    setJobs((prev) => [...prev, ...base]);
    setPhase("idle");
    setFinished(0);
    setRunTotal(0);

    // thumbnails with bounded concurrency
    let idx = 0;
    const worker = async () => {
      while (idx < base.length) {
        const i = idx++;
        const thumb = await makeThumb(taken[i]);
        setJobs((prev) => {
          if (!prev.some((j) => j.id === base[i].id)) {
            // row was removed while its thumbnail was rendering
            if (thumb) URL.revokeObjectURL(thumb);
            return prev;
          }
          return prev.map((j) => (j.id === base[i].id ? { ...j, thumb } : j));
        });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(THUMB_CONCURRENCY, base.length) }, worker)
    );
  };

  /* ── queue management ───────────────────────────────────────────────── */

  const resetToQueued = () => {
    setJobs((prev) =>
      prev.map((j) =>
        j.status === "queued"
          ? j
          : { ...j, status: "queued", outName: "", outBlob: null, error: "" }
      )
    );
    setPhase("idle");
    setFinished(0);
    setRunTotal(0);
  };

  /** changing settings invalidates previous results */
  const touchResults = () => {
    if (phase === "done") resetToQueued();
  };

  const changeOp = (o: Op) => {
    if (busy || o === op) return;
    setOp(o);
    touchResults();
  };
  const changeQuality = (v: number) => {
    setQuality(v);
    touchResults();
  };
  const changeFormat = (f: Format) => {
    if (f === format) return;
    setFormat(f);
    touchResults();
  };
  const changeEdge = (n: number) => {
    setMaxEdge(Math.min(8000, Math.max(64, n || 1600)));
    touchResults();
  };
  const changeRot = (r: 90 | 180 | 270) => {
    if (r === rot) return;
    setRot(r);
    touchResults();
  };

  const removeJob = (id: string) => {
    if (busy) return;
    const j = jobsRef.current.find((x) => x.id === id);
    if (j?.thumb) URL.revokeObjectURL(j.thumb);
    setJobs((prev) => prev.filter((x) => x.id !== id));
  };

  const clearAll = () => {
    if (busy) return;
    for (const j of jobsRef.current) if (j.thumb) URL.revokeObjectURL(j.thumb);
    setJobs([]);
    setPhase("idle");
    setFinished(0);
    setRunTotal(0);
  };

  /* ── run ─────────────────────────────────────────────────────────────── */

  const run = async () => {
    const targets = jobsRef.current.filter((j) => j.status === "queued");
    if (jobsRef.current.length === 0) {
      toast.error(t("bsNeedFiles"));
      return;
    }
    if (targets.length === 0) return;

    cancelRef.current = false;
    setPhase("running");
    setFinished(0);
    setRunTotal(targets.length);

    let done = 0;
    let failed = 0;
    const cfg = cfgRef.current;

    for (const j of targets) {
      if (cancelRef.current) break;
      setJobs((prev) =>
        prev.map((x) => (x.id === j.id ? { ...x, status: "running", error: "" } : x))
      );
      try {
        const { blob, ext } = await processFile(j.file, cfg.op, {
          quality: cfg.quality,
          format: cfg.format,
          maxEdge: cfg.maxEdge,
          rot: cfg.rot,
        });
        done++;
        setJobs((prev) =>
          prev.map((x) =>
            x.id === j.id
              ? {
                  ...x,
                  status: "done",
                  outBlob: blob,
                  outName: `${safeName(stripExt(j.file.name))}.${ext}`,
                  error: "",
                }
              : x
          )
        );
      } catch (e) {
        failed++;
        const msg =
          e instanceof Error && e.message ? e.message : t("bsFailedLabel");
        setJobs((prev) =>
          prev.map((x) =>
            x.id === j.id
              ? { ...x, status: "failed", outBlob: null, outName: "", error: msg }
              : x
          )
        );
      }
      setFinished((f) => f + 1);
    }

    setPhase("done");
    if (cancelRef.current) {
      toast.info(t("bsStopped"));
    } else if (failed === 0) {
      toast.success(t("bsAllOk"));
    } else if (done > 0) {
      toast.warning(`${num(done)} ${t("bsSucceeded")}, ${num(failed)} ${t("bsFailedOf")}`);
    } else {
      toast.error(t("bsPartial"));
    }
  };

  const retryFailed = () => {
    if (busy) return;
    setJobs((prev) =>
      prev.map((j) => (j.status === "failed" ? { ...j, status: "queued", error: "" } : j))
    );
    setFinished(0);
    // let the state commit land, then auto-run the freshly queued jobs
    window.setTimeout(() => void run(), 120);
  };

  /* ── ZIP ─────────────────────────────────────────────────────────────── */

  const downloadZip = async () => {
    const doneJobs = jobsRef.current.filter((j) => j.status === "done" && j.outBlob);
    if (doneJobs.length === 0) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      for (const j of doneJobs) {
        let name = j.outName || j.file.name;
        let n = 2;
        while (used.has(name)) {
          const dot = name.lastIndexOf(".");
          name =
            dot > 0
              ? `${name.slice(0, dot)}-${n}${name.slice(dot)}`
              : `${name}-${n}`;
          n += 1;
        }
        used.add(name);
        zip.file(name, j.outBlob as Blob);
      }
      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      downloadBlob(zipBlob, `file-magic-batch-${cfgRef.current.op}.zip`);
      toast.success(t("bsZipDone"));
    } catch {
      toast.error(t("bsZipFail"));
    } finally {
      setZipping(false);
    }
  };

  /* ── derived ─────────────────────────────────────────────────────────── */

  const total = jobs.length;
  const doneJobs = jobs.filter((j) => j.status === "done");
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const totalIn = doneJobs.reduce((s, j) => s + j.file.size, 0);
  const totalOut = doneJobs.reduce((s, j) => s + (j.outBlob?.size ?? 0), 0);
  const savedPct =
    totalIn > 0 && totalOut > 0 && totalOut < totalIn
      ? Math.round(((totalIn - totalOut) / totalIn) * 100)
      : 0;
  const progressPct = runTotal > 0 ? Math.min(100, Math.round((finished / runTotal) * 100)) : 0;

  const OPS: { id: Op; label: string; Icon: typeof Layers }[] = [
    { id: "compress", label: t("bsOpCompress"), Icon: Minimize2 },
    { id: "convert", label: t("bsOpConvert"), Icon: Repeat },
    { id: "resize", label: t("bsOpResize"), Icon: Scaling },
    { id: "rotate", label: t("bsOpRotate"), Icon: RotateCw },
    { id: "grayscale", label: t("bsOpGray"), Icon: Contrast },
  ];

  const chipCls = (active: boolean) =>
    `h-9 rounded-lg border px-2.5 text-xs font-semibold transition ${
      active
        ? "border-amber-500/60 bg-amber-500/20 text-amber-700 dark:text-amber-300"
        : "border-white/10 bg-white/[0.04] text-foreground/70 hover:bg-white/[0.08]"
    }`;

  const rowStatus = (j: Job) => {
    if (j.status === "done")
      return (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
          <Check className="h-4 w-4" aria-hidden />
        </span>
      );
    if (j.status === "running")
      return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-600" aria-hidden />;
    if (j.status === "failed")
      return <CircleAlert className="h-5 w-5 shrink-0 text-red-500" aria-hidden />;
    return <Clock className="h-4 w-4 shrink-0 text-foreground/35" aria-hidden />;
  };

  /* ── empty state ─────────────────────────────────────────────────────── */

  if (total === 0) {
    return (
      <div className="flex min-h-screen flex-col" lang={lang}>
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-5 px-4 py-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center"
          >
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/30">
              <Layers className="h-8 w-8 text-white" aria-hidden />
            </span>
            <h1 className="mt-5 text-xl font-bold sm:text-2xl">{t("bsTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("bsTagline")}</p>

            <div
              role="button"
              tabIndex={0}
              aria-label={t("bsAddAria")}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => {
                e.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
              }}
              onDragLeave={() => {
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                void addFiles(e.dataTransfer?.files ?? null);
              }}
              className={`mt-6 w-full cursor-pointer rounded-2xl border-2 border-dashed p-10 outline-none transition-all focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
                dragging
                  ? "scale-[1.01] border-amber-500 bg-amber-500/10"
                  : "border-white/15 bg-white/[0.03] hover:border-amber-500/50 hover:bg-white/[0.06]"
              }`}
            >
              <motion.div
                animate={dragging ? { y: [0, -6, 0] } : { y: 0 }}
                transition={
                  dragging
                    ? { repeat: Infinity, duration: 2, ease: "easeInOut" }
                    : { duration: 0.2 }
                }
              >
                <UploadCloud className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
              </motion.div>
              <p className="mt-3 font-semibold">{t("bsEmpty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("bsEmptyHint")}</p>
            </div>

            <Button
              onClick={() => inputRef.current?.click()}
              className="mt-5 h-12 bg-gradient-to-r from-amber-500 to-orange-600 px-8 font-semibold text-white shadow-amber-500/30 hover:from-amber-400 hover:to-orange-500"
            >
              <ImageIcon className="mr-2 h-5 w-5" aria-hidden />
              {t("bsAdd")}
            </Button>

            <p className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden />
              {t("bsPrivacy")}
            </p>
          </motion.div>
        </main>

        <p className="mt-auto px-4 pb-6 text-center text-xs text-muted-foreground">
          {t("footerLine")}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-label={t("bsAddAria")}
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  /* ── studio ──────────────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-screen flex-col" lang={lang}>
      <header className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={goHome}
          aria-label={t("brandName")}
          className="h-11 w-11 shrink-0"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-base font-bold sm:text-lg">
            <Layers className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            {t("bsTitle")}
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {t("bsTagline")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {busy ? (
            <Button
              size="sm"
              onClick={() => {
                cancelRef.current = true;
              }}
              className="h-11 border-red-500/40 bg-red-500/10 px-4 text-red-600 hover:bg-red-500/20 hover:text-red-600 dark:text-red-400"
              variant="outline"
            >
              <X className="mr-2 h-4 w-4" aria-hidden />
              {t("bsStop")}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void run()}
              className="h-11 bg-gradient-to-r from-amber-500 to-orange-600 px-4 font-semibold text-white shadow-amber-500/25 hover:from-amber-400 hover:to-orange-500"
            >
              <Layers className="mr-2 h-4 w-4" aria-hidden />
              {phase === "done" ? t("bsRerun") : t("bsRun")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={clearAll}
            aria-label={t("bsClearAria")}
            className="h-11 px-3"
          >
            <X className="mr-1 h-4 w-4" aria-hidden />
            {t("bsClear")}
          </Button>
        </div>
      </header>

      {busy && (
        <div className="mx-auto w-full max-w-6xl px-3 sm:px-4" role="status" aria-live="polite">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              {t("bsRunning")}
              <span className="ml-auto font-semibold">
                {num(Math.round(progressPct))}%
              </span>
            </div>
            <Progress
              value={progressPct}
              className="mt-2 h-1.5 bg-amber-100 [&>div]:bg-gradient-to-r [&>div]:from-amber-500 [&>div]:to-orange-500"
            />
          </div>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-3 pb-4 sm:px-4 lg:flex-row">
        {/* left: operation settings + file queue */}
        <section className="w-full shrink-0 space-y-4 lg:w-80" aria-label={t("bsTitle")}>
          <div>
            <Label className="mb-2 text-sm font-semibold">{t("bsOp")}</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("bsOp")}>
              {OPS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={op === o.id}
                  disabled={busy}
                  onClick={() => changeOp(o.id)}
                  className={`flex h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition disabled:opacity-60 ${
                    op === o.id
                      ? "border-amber-500/60 bg-amber-500/20 text-amber-700 dark:text-amber-300"
                      : "border-white/10 bg-white/[0.04] text-foreground/70 hover:bg-white/[0.08]"
                  }`}
                >
                  <o.Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {op === "compress" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center">
                <Label className="text-sm font-semibold">{t("bsQuality")}</Label>
                <span className="ml-auto rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {num(quality)}%
                </span>
              </div>
              <Slider
                min={10}
                max={95}
                step={5}
                value={[quality]}
                onValueChange={(vals) => changeQuality(vals[0] ?? 75)}
                aria-label={t("bsQuality")}
                disabled={busy}
              />
            </div>
          )}

          {op === "convert" && (
            <div>
              <Label className="mb-2 text-sm font-semibold">{t("bsFormat")}</Label>
              <div className="flex gap-2" role="radiogroup" aria-label={t("bsFormat")}>
                {(
                  [
                    ["jpeg", "JPG"],
                    ["png", "PNG"],
                    ["webp", "WebP"],
                  ] as [Format, string][]
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={format === v}
                    disabled={busy}
                    onClick={() => changeFormat(v)}
                    className={`${chipCls(format === v)} h-11 flex-1`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {op === "resize" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bs-edge" className="text-sm font-semibold">
                {t("bsMaxEdge")}
              </Label>
              <Input
                id="bs-edge"
                type="number"
                min={64}
                max={8000}
                step={50}
                value={maxEdge}
                disabled={busy}
                onChange={(e) => changeEdge(Number(e.target.value))}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">{t("bsMaxEdgeHint")}</p>
            </div>
          )}

          {op === "rotate" && (
            <div>
              <Label className="mb-2 text-sm font-semibold">{t("bsRot")}</Label>
              <div className="flex gap-2" role="radiogroup" aria-label={t("bsRot")}>
                {(
                  [
                    [90, "bsRot90"],
                    [180, "bsRot180"],
                    [270, "bsRot270"],
                  ] as const
                ).map(([v, key]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={rot === v}
                    disabled={busy}
                    onClick={() => changeRot(v)}
                    className={`${chipCls(rot === v)} h-11 flex-1`}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {op === "grayscale" && (
            <p className="text-xs text-muted-foreground">{t("bsGrayNote")}</p>
          )}

          <div>
            <Label className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {t("bsQueue")}
              <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                {num(total)}
              </span>
            </Label>
            <div className="fm-scroll max-h-[38vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[52vh]">
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2"
                >
                  {j.thumb ? (
                    <img
                      src={j.thumb}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06]">
                      <ImageIcon className="h-5 w-5 text-amber-600/70" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{j.file.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {j.status === "done" && j.outBlob
                        ? `${formatBytes(j.file.size)} → ${formatBytes(j.outBlob.size)}`
                        : j.status === "failed" && j.error
                          ? <span className="text-red-500">{j.error}</span>
                          : j.status === "running"
                            ? t("bsRunning")
                            : `${formatBytes(j.file.size)} · ${t("bsQueued")}`}
                    </p>
                  </div>
                  {rowStatus(j)}
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => removeJob(j.id)}
                    aria-label={t("bsRemoveAria")}
                    className="h-7 w-7 shrink-0 text-foreground/40 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* right: results / idle info */}
        <section
          className="flex min-h-[40vh] flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:min-h-0"
          aria-label={t("bsSummary")}
        >
          {doneJobs.length === 0 && failedJobs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15">
                <Layers className="h-7 w-7 text-amber-600" aria-hidden />
              </span>
              <p className="text-sm font-semibold">
                {num(total)} {t("bsReady")}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">{t("bsPrivacy")}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-3">
              <div
                aria-live="polite"
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                  failedJobs.length > 0
                    ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {failedJobs.length > 0 ? (
                  <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="font-semibold">
                  {num(doneJobs.length)} {t("bsSucceeded")}
                  {failedJobs.length > 0
                    ? `, ${num(failedJobs.length)} ${t("bsFailedOf")}`
                    : ""}
                </span>
                {savedPct > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold">
                    {num(savedPct)}% {t("bsSaved")}
                  </span>
                )}
              </div>

              <div className="fm-scroll flex-1 space-y-2 overflow-y-auto pr-1">
                {[...doneJobs, ...failedJobs].map((j) => (
                  <div
                    key={j.id}
                    className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2"
                  >
                    {j.thumb ? (
                      <img
                        src={j.thumb}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06]">
                        <ImageIcon className="h-5 w-5 text-amber-600/70" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {j.status === "done" && j.outName ? j.outName : j.file.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {j.status === "done" && j.outBlob
                          ? `${formatBytes(j.file.size)} → ${formatBytes(j.outBlob.size)}`
                          : j.error
                            ? <span className="text-red-500">{j.error}</span>
                            : ""}
                      </p>
                    </div>
                    {j.status === "done" && j.outBlob ? (
                      <Button
                        size="icon"
                        onClick={() => downloadBlob(j.outBlob as Blob, j.outName || j.file.name)}
                        aria-label={`${t("bsDownloadAria")}: ${j.outName}`}
                        className="h-9 w-9 shrink-0 bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm hover:from-amber-400 hover:to-orange-500"
                      >
                        <Download className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : (
                      <CircleAlert className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                {failedJobs.length > 0 && !busy && (
                  <Button
                    variant="outline"
                    onClick={retryFailed}
                    className="h-11 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-300"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                    {t("bsRetryFailed")}
                  </Button>
                )}
                {doneJobs.length > 0 && (
                  <Button
                    onClick={() => void downloadZip()}
                    disabled={zipping}
                    className="h-12 bg-gradient-to-r from-amber-500 to-orange-600 font-semibold text-white shadow-amber-500/25 hover:from-amber-400 hover:to-orange-500"
                  >
                    {zipping ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
                    ) : (
                      <Archive className="mr-2 h-5 w-5" aria-hidden />
                    )}
                    {zipping ? t("bsZipMaking") : t("bsZip")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      <p className="mt-auto px-4 pb-6 text-center text-xs text-muted-foreground">
        {t("footerLine")}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        aria-label={t("bsAddAria")}
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
