"use client";

/* ═══════════════════════════════════════════════════════════════════════
   Compression Studio 2.0 — Day 5 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Pain point: "কত ছোট হবে জানি না, কোয়ালিটি নষ্ট হয়ে যায়"

   Live compression workspace (100% client-side):
     drop images (≤30) → pick one to preview
     quality slider (live, debounced 250ms) → REAL re-encode of the
       preview image → predicted output size + savings %
     before/after compare pane with a draggable divider (pointer events)
     "Run on all" → sequential per-file compress (fault-isolated),
       per-file before→after sizes + saved %, summary + single ZIP.

   Output rules (mirror batch studio):
     format=jpeg → white base; webp → alpha kept;
     auto → jpeg stays jpeg, everything else becomes webp.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock,
  Download,
  Gauge,
  ImageDown,
  Loader2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/lib/i18n";
import { downloadBlob, formatBytes, safeName, stripExt } from "@/lib/tools/helpers";
import { err } from "@/lib/tools/messages";
import { useAppStore } from "@/store/app-store";

/* ── constants & types ─────────────────────────────────────────────────── */

const MAX_FILES = 30;
const THUMB = 96;
const PREVIEW_BOX = 560; // live-compare pane long edge

type Fmt = "auto" | "jpeg" | "webp";
type Status = "queued" | "running" | "done" | "failed";
type Phase = "idle" | "running" | "done";

type Item = {
  id: string;
  file: File;
  thumb: string;
  status: Status;
  outBlob: Blob | null;
  outName: string;
  error: string;
};

type Preview = {
  beforeUrl: string;
  afterUrl: string;
  beforeSize: number;
  afterSize: number;
  dims: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ── encode helpers ────────────────────────────────────────────────────── */

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

/** target format for one source file under the current settings */
function targetFor(file: File, fmt: Fmt): { mime: string; ext: string; white: boolean } {
  const src = (file.type || "").toLowerCase();
  if (fmt === "jpeg") return { mime: "image/jpeg", ext: "jpg", white: true };
  if (fmt === "webp") return { mime: "image/webp", ext: "webp", white: false };
  // auto: jpeg stays jpeg; everything else → webp (alpha kept)
  if (src === "image/jpeg") return { mime: "image/jpeg", ext: "jpg", white: true };
  return { mime: "image/webp", ext: "webp", white: false };
}

/** compress one file → output blob (throws localized errors) */
async function compressOne(
  file: File,
  quality: number,
  fmt: Fmt,
  maxEdge: number
): Promise<{ blob: Blob; ext: string; w: number; h: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await bitmapFrom(file);
  } catch {
    throw err("imageCorrupt", file.name);
  }
  try {
    if (!bmp.width || !bmp.height) throw err("imageCorrupt", file.name);
    const t = targetFor(file, fmt);
    let w = bmp.width;
    let h = bmp.height;
    if (maxEdge > 0) {
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = canvasOf(w, h, t.white);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const blob = await encode(canvas, t.mime, quality / 100);
    return { blob, ext: t.ext, w, h };
  } finally {
    bmp.close();
  }
}

/** tiny list thumbnail */
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

/* ── component ─────────────────────────────────────────────────────────── */

export function CompressionStudio() {
  const { t, num } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [quality, setQuality] = useState(75);
  const [fmt, setFmt] = useState<Fmt>("auto");
  const [maxEdge, setMaxEdge] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [split, setSplit] = useState(50); // compare divider %
  const [zipping, setZipping] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const previewUrlsRef = useRef<string[]>([]);
  const stopRef = useRef(false);
  const itemsCountRef = useRef(0);

  const revoke = (list: string[]) => list.forEach((u) => u && URL.revokeObjectURL(u));

  useEffect(() => {
    return () => {
      revoke(urlsRef.current);
      revoke(previewUrlsRef.current);
    };
  }, []);

  /* ── intake ── */
  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const arr = Array.from(list);
      const imgs = arr.filter(
        (f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name)
      );
      const skipped = arr.length - imgs.length;
      if (skipped > 0) toast.error(`${num(skipped)} ${t("bsSkipped")}`);
      if (imgs.length === 0) return;

      const room = MAX_FILES - itemsCountRef.current;
      if (imgs.length > room) toast.error(t("csTooMany"));
      const take = imgs.slice(0, Math.max(0, room));
      if (take.length === 0) return;

      const rows: Item[] = [];
      for (const f of take) {
        rows.push({
          id: uid(),
          file: f,
          thumb: await makeThumb(f),
          status: "queued",
          outBlob: null,
          outName: "",
          error: "",
        });
      }
      rows.forEach((r) => {
        if (r.thumb) urlsRef.current.push(r.thumb);
      });
      setItems((prev) => {
        const next = [...prev, ...rows];
        itemsCountRef.current = next.length;
        return next;
      });
      setPreviewId((cur) => cur ?? rows[0]?.id ?? null);
      setPhase("idle");
    },
    [t, num]
  );

  const removeItem = (id: string) => {
    setItems((prev) => {
      const row = prev.find((r) => r.id === id);
      if (row?.thumb) {
        urlsRef.current = urlsRef.current.filter((u) => {
          if (u === row.thumb) {
            URL.revokeObjectURL(u);
            return false;
          }
          return true;
        });
      }
      const next = prev.filter((r) => r.id !== id);
      itemsCountRef.current = next.length;
      return next;
    });
    setPreviewId((cur) => (cur === id ? null : cur));
    setPhase("idle");
  };

  const clearAll = () => {
    revoke(urlsRef.current);
    urlsRef.current = [];
    itemsCountRef.current = 0;
    setItems([]);
    setPreviewId(null);
    setPreview(null);
    setPhase("idle");
  };

  /** any settings change invalidates a finished run (mirror batch studio) */
  const changeSettings = (apply: () => void) => {
    apply();
    setPhase((p) => {
      if (p !== "idle") {
        setItems((prev) =>
          prev.map((r) => ({ ...r, status: "queued" as Status, outBlob: null, outName: "", error: "" }))
        );
        return "idle";
      }
      return p;
    });
  };

  /* ── live preview + size prediction (debounced) ── */
  const previewItem = items.find((i) => i.id === previewId) ?? null;

  useEffect(() => {
    if (!previewItem) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewBusy(true);
    const file = previewItem.file;
    const timer = setTimeout(async () => {
      try {
        const { blob, w, h } = await compressOne(file, quality, fmt, maxEdge);
        if (cancelled) return;
        const beforeUrl = URL.createObjectURL(file);
        const afterUrl = URL.createObjectURL(blob);
        revoke(previewUrlsRef.current);
        previewUrlsRef.current = [beforeUrl, afterUrl];
        setPreview({
          beforeUrl,
          afterUrl,
          beforeSize: file.size,
          afterSize: blob.size,
          dims: `${w}×${h}`,
        });
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewItem, quality, fmt, maxEdge]);

  /* ── divider drag ── */
  const paneRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromEvent = (clientX: number) => {
    const el = paneRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSplit(Math.min(96, Math.max(4, ((clientX - r.left) / r.width) * 100)));
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current) setFromEvent(e.clientX);
    };
    const up = () => (dragging.current = false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  /* ── run all (fault-isolated, sequential) ── */
  const runAll = async () => {
    if (items.length === 0) return toast.error(t("csNeedFiles"));
    setPhase("running");
    setProgress(0);
    stopRef.current = false;
    setItems((prev) =>
      prev.map((r) => ({ ...r, status: "queued" as Status, outBlob: null, outName: "", error: "" }))
    );
    let done = 0;
    let ok = 0;
    for (const row of items) {
      if (stopRef.current) break;
      setItems((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: "running" as Status } : r))
      );
      try {
        const { blob, ext } = await compressOne(row.file, quality, fmt, maxEdge);
        const outName = safeName(`${stripExt(row.file.name)}-min.${ext}`);
        setItems((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, status: "done" as Status, outBlob: blob, outName } : r
          )
        );
        ok++;
      } catch (e) {
        setItems((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  status: "failed" as Status,
                  error: e instanceof Error ? e.message : t("genericErr"),
                }
              : r
          )
        );
      }
      done++;
      setProgress(Math.round((done / items.length) * 100));
    }
    setPhase("done");
    if (ok > 0) toast.success(`${num(ok)} ${t("csRunDone")}`);
  };

  /* ── summary ── */
  const results = items.filter((r) => r.status === "done" && r.outBlob);
  const inBytes = results.reduce((a, r) => a + r.file.size, 0);
  const outBytes = results.reduce((a, r) => a + (r.outBlob?.size ?? 0), 0);
  const savedPct = inBytes > 0 ? Math.round(((inBytes - outBytes) / inBytes) * 100) : 0;
  const failedCount = items.filter((r) => r.status === "failed").length;

  const downloadZip = async () => {
    if (results.length === 0) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      for (const r of results) {
        let name = r.outName || safeName(stripExt(r.file.name) + ".jpg");
        let k = 2;
        while (used.has(name)) name = name.replace(/(\.[^.]+)$/, `-${k++}$1`);
        used.add(name);
        zip.file(name, r.outBlob!);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      downloadBlob(blob, "file-magic-compressed.zip");
      toast.success(t("bsZipDone"));
    } catch {
      toast.error(t("bsZipFail"));
    } finally {
      setZipping(false);
    }
  };

  const pctSavedFor = (r: Item) =>
    r.outBlob ? Math.max(0, Math.round(((r.file.size - r.outBlob.size) / r.file.size) * 100)) : 0;

  /* ── render ── */
  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-10 pt-4 sm:px-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={goHome}
          aria-label={t("backHomeAria")}
          className="h-11 w-11 rounded-xl"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-fuchsia-500/30">
          <Gauge className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold sm:text-xl">{t("csTitle")}</h1>
          <p className="truncate text-xs text-muted-foreground">{t("csTagline")}</p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          {t("bsPrivacy")}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif"
        multiple
        className="sr-only"
        aria-label={t("csAddAria")}
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* empty state */}
      {items.length === 0 && (
        <div
          role="button"
          tabIndex={0}
          aria-label={t("csAddAria")}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
          }}
          className={`flex min-h-[320px] cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed bg-white/60 p-8 text-center transition dark:bg-white/5 ${
            dragOver ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-500/10" : "border-border"
          }`}
        >
          <UploadCloud className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
          <p className="text-lg font-bold">{t("csEmpty")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("csEmptyHint")}</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* ── left: live compare + settings ── */}
          <div className="order-2 space-y-4 lg:order-1">
            {/* compare pane */}
            <div className="fm-card overflow-hidden rounded-2xl p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold">{t("csCompare")}</h2>
                {previewBusy && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("csPredicting")}
                  </span>
                )}
              </div>
              {preview && previewItem ? (
                <>
                  <div
                    ref={paneRef}
                    className="relative select-none overflow-hidden rounded-xl bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#ffffff_0%_50%)] bg-[length:20px_20px] dark:bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)]"
                    style={{ aspectRatio: "4 / 3" }}
                    onPointerDown={(e) => {
                      dragging.current = true;
                      setFromEvent(e.clientX);
                    }}
                  >
                    {/* after (full) */}
                    <img
                      src={preview.afterUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-contain"
                      draggable={false}
                    />
                    {/* before (clipped) */}
                    <img
                      src={preview.beforeUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-contain"
                      style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                      draggable={false}
                    />
                    {/* divider */}
                    <div
                      className="absolute inset-y-0 z-10 w-0.5 bg-emerald-600 shadow-[0_0_0_1px_rgba(255,255,255,0.6)] dark:bg-emerald-400"
                      style={{ left: `${split}%` }}
                    >
                      <span
                        role="slider"
                        aria-label={t("csCompareAria")}
                        aria-valuenow={Math.round(split)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowLeft") setSplit((s) => Math.max(4, s - 4));
                          if (e.key === "ArrowRight") setSplit((s) => Math.min(96, s + 4));
                        }}
                        className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg dark:bg-emerald-500"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                          <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
                        </svg>
                      </span>
                    </div>
                    {/* labels */}
                    <span className="absolute left-2 top-2 z-10 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">
                      {t("csBefore")} · {formatBytes(preview.beforeSize)}
                    </span>
                    <span className="absolute right-2 top-2 z-10 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
                      {t("csAfter")} · {formatBytes(preview.afterSize)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{previewItem.file.name} · {preview.dims}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ${
                        preview.afterSize <= preview.beforeSize
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                      }`}
                    >
                      <Sparkles className="h-3 w-3" aria-hidden />
                      {preview.afterSize <= preview.beforeSize
                        ? `−${num(Math.max(0, Math.round(((preview.beforeSize - preview.afterSize) / preview.beforeSize) * 100)))}% ${t("csSmaller")}`
                        : `+${num(Math.round(((preview.afterSize - preview.beforeSize) / preview.beforeSize) * 100))}% ${t("csBigger")}`}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 text-sm text-muted-foreground dark:bg-white/5">
                  <ImageDown className="h-8 w-8 opacity-50" aria-hidden />
                  {t("csPickPreview")}
                </div>
              )}
            </div>

            {/* settings */}
            <div className="fm-card rounded-2xl p-4">
              <h2 className="mb-3 text-sm font-bold">{t("csSettings")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-semibold" htmlFor="cs-quality">
                      {t("csQuality")}
                    </label>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {num(quality)}%
                    </span>
                  </div>
                  <Slider
                    id="cs-quality"
                    value={[quality]}
                    min={5}
                    max={95}
                    step={5}
                    onValueChange={(v) => changeSettings(() => setQuality(v[0] ?? 75))}
                    aria-label={t("csQuality")}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold" htmlFor="cs-fmt">
                    {t("csFormat")}
                  </label>
                  <select
                    id="cs-fmt"
                    value={fmt}
                    onChange={(e) => changeSettings(() => setFmt(e.target.value as Fmt))}
                    className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm dark:bg-white/5"
                  >
                    <option value="auto">{t("csFmtAuto")}</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-semibold" htmlFor="cs-edge">
                      {t("csMaxEdge")}
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {maxEdge === 0 ? t("csEdgeOff") : `${num(maxEdge)} px`}
                    </span>
                  </div>
                  <Slider
                    id="cs-edge"
                    value={[maxEdge]}
                    min={0}
                    max={4000}
                    step={100}
                    onValueChange={(v) => changeSettings(() => setMaxEdge(v[0] ?? 0))}
                    aria-label={t("csMaxEdge")}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">{t("bsMaxEdgeHint")}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={runAll}
                  disabled={phase === "running"}
                  className="h-11 flex-1 gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-lg shadow-emerald-500/30 hover:from-emerald-600 hover:to-teal-700"
                >
                  {phase === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {phase === "running" ? t("csRunning") : t("csRunAll")}
                </Button>
                {phase === "running" ? (
                  <Button
                    variant="outline"
                    onClick={() => (stopRef.current = true)}
                    className="h-11 rounded-xl border-rose-200 font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/30"
                  >
                    {t("bsStop")}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={clearAll} className="h-11 rounded-xl font-semibold">
                    {t("bsClear")}
                  </Button>
                )}
              </div>
              {phase === "running" && (
                <div className="mt-3">
                  <Progress value={progress} aria-label={t("progressAria")} />
                </div>
              )}
            </div>
          </div>

          {/* ── right: file list ── */}
          <div className="order-1 lg:order-2">
            <div className="fm-card rounded-2xl p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold">
                  {t("bsQueue")} · {num(items.length)}
                </h2>
                {phase === "done" && results.length > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    {savedPct > 0 ? `−${num(savedPct)}% ${t("bsSaved")}` : t("csNoSaving")}
                  </span>
                )}
              </div>
              <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pe-1 fm-scroll" aria-label={t("bsQueue")}>
                {items.map((r) => (
                  <li key={r.id}>
                    <div
                      className={`flex items-center gap-2 rounded-xl border p-1.5 transition ${
                        previewId === r.id
                          ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-500/10"
                          : "border-transparent hover:border-border"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewId(r.id)}
                        aria-label={`${t("csPickPreview")}: ${r.file.name}`}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {r.thumb ? (
                          <img src={r.thumb} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-white/10" />
                        ) : (
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-white/10">
                            <ImageDown className="h-4 w-4 text-slate-400" aria-hidden />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">{r.file.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {r.status === "done" && r.outBlob
                              ? `${formatBytes(r.file.size)} → ${formatBytes(r.outBlob.size)} · −${num(pctSavedFor(r))}%`
                              : r.status === "failed"
                                ? r.error
                                : formatBytes(r.file.size)}
                          </span>
                        </span>
                      </button>
                      <span className="shrink-0" aria-hidden>
                        {r.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                        {r.status === "failed" && <CircleAlert className="h-4 w-4 text-rose-500" />}
                        {r.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-400" />}
                        {r.status === "queued" && <Clock className="h-4 w-4 text-slate-400" />}
                      </span>
                      {r.status === "done" && r.outBlob && (
                        <button
                          type="button"
                          onClick={() => downloadBlob(r.outBlob!, r.outName)}
                          aria-label={`${t("download")}: ${r.file.name}`}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(r.id)}
                        aria-label={`${t("remove")}: ${r.file.name}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {phase === "done" && (
                <Button
                  onClick={downloadZip}
                  disabled={results.length === 0 || zipping}
                  className="mt-3 h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-lg shadow-emerald-500/30 hover:from-emerald-600 hover:to-teal-700"
                >
                  {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {zipping ? t("bsZipMaking") : `${t("bsZip")} (${num(results.length)})`}
                </Button>
              )}
              {phase === "done" && failedCount > 0 && (
                <p className="mt-2 text-center text-xs text-rose-600 dark:text-rose-400">
                  {num(failedCount)} {t("bsFailedOf")}
                </p>
              )}
              <p className="mt-2 text-center text-[11px] text-muted-foreground">{t("csHint")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
