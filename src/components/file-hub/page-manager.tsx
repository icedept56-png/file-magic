"use client";

/* ═══════════════════════════════════════════════════════════════════════
   PDF Page Manager 2.0 — Day 4 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Pain point: "PDF-এর পেজ সাজাতে দেখতে দেখতে সাজানোর সুবিধা নেই"

   Visual page workspace (100% client-side):
     PDF → pdf.js thumbnails (≤200 pages, pool of 4)
     every page = { pdf page | blank A4 | image page }, user rotation 0/90/180/270
     ops: select (click), drag-reorder (+ ↑↓ for touch/keyboard),
          delete, rotate L/R, extract selection → new PDF,
          insert blank A4 / image pages after the last selection
     export → pdf-lib rebuild: copyPages in visible order with rotation,
              blank pages, embedded image pages → single download.

   Thumbnails are object-URLs (revoked on remove/clear/unmount).
   The source File is re-read on export — pdf.js owns (detaches) its copy.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckSquare,
  FileOutput,
  FilePlus2,
  GripVertical,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Redo2,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  Square,
  Trash2,
  Undo2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { useEditorHistory, useUndoRedoKeys } from "@/lib/use-history";
import { downloadBlob, formatBytes, safeName, stripExt } from "@/lib/tools/helpers";
import { err } from "@/lib/tools/messages";
import { useAppStore } from "@/store/app-store";

/* ── types ─────────────────────────────────────────────────────────────── */

type Rot = 0 | 90 | 180 | 270;

type PageEntry =
  | { id: string; kind: "pdf"; srcIdx: number; baseRot: number; rot: Rot; thumb: string }
  | { id: string; kind: "blank"; w: number; h: number; rot: Rot; thumb: "" }
  | { id: string; kind: "image"; file: File; rot: Rot; thumb: string };

const uid = () => Math.random().toString(36).slice(2, 10);
const A4: [number, number] = [595.28, 841.89];
const MAX_PAGES = 200;
const THUMB_BOX = 240;
const POOL = 4;

const stepRot = (r: Rot, dir: 1 | -1): Rot =>
  (((r + dir * 90) % 360 + 360) % 360) as Rot;

/* ── thumbnail rendering (pdf.js) ──────────────────────────────────────── */

async function renderThumbs(
  file: File,
  onOne: (idx: number, baseRot: number, thumb: string) => void,
  onProgress: (pct: number) => void,
  signal: { cancelled: boolean }
): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const count = Math.min(doc.numPages, MAX_PAGES);
  try {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < count) {
        if (signal.cancelled) return;
        const i = next++;
        const page = await doc.getPage(i + 1);
        const base = page.rotate ?? 0;
        const vp1 = page.getViewport({ scale: 1 });
        const scale = THUMB_BOX / Math.max(vp1.width, vp1.height);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(vp.width));
        canvas.height = Math.max(1, Math.ceil(vp.height));
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp } as never).promise;
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob((b) => res(b), "image/jpeg", 0.72)
        );
        canvas.width = 0;
        if (signal.cancelled) return;
        onOne(i, base, blob ? URL.createObjectURL(blob) : "");
        done++;
        onProgress(Math.round((done / count) * 100));
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, count) }, worker));
    return doc.numPages;
  } finally {
    doc.destroy();
  }
}

/* ── pdf export builder (pdf-lib) ──────────────────────────────────────── */

async function buildPdf(
  srcFile: File | null,
  entries: PageEntry[],
  onProgress: (pct: number, label?: string) => void
): Promise<Uint8Array> {
  const { PDFDocument, degrees, rgb } = await import("pdf-lib");
  const out = await PDFDocument.create();
  let src: Awaited<ReturnType<(typeof import("pdf-lib").PDFDocument)["load"]>> | null = null;

  let done = 0;

  for (const e of entries) {
    if (e.kind === "pdf") {
      if (!src) {
        onProgress(5);
        try {
          src = await PDFDocument.load(await srcFile!.arrayBuffer(), {
            ignoreEncryption: true,
          });
        } catch {
          throw err("pdfLoadFail");
        }
      }
      const [copied] = await out.copyPages(src, [e.srcIdx]);
      copied.setRotation(degrees((e.baseRot + e.rot) % 360));
      out.addPage(copied);
    } else if (e.kind === "blank") {
      const swap = e.rot === 90 || e.rot === 270;
      out.addPage(swap ? [e.h, e.w] : [e.w, e.h]);
    } else {
      // image page — A4, fit + centered; rotation is baked in client-side
      // (canvas rotate → JPEG) so pdf-lib never needs rotation math here
      try {
        const bmp = await createImageBitmap(e.file);
        const swap = e.rot === 90 || e.rot === 270;
        const c = document.createElement("canvas");
        c.width = swap ? bmp.height : bmp.width;
        c.height = swap ? bmp.width : bmp.height;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((e.rot * Math.PI) / 180);
        ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
        bmp.close();
        const blob = await new Promise<Blob>((res, rej) =>
          c.toBlob((b) => (b ? res(b) : rej(new Error("encode-fail"))), "image/jpeg", 0.9)
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const img = await out.embedJpg(bytes);
        const pw = A4[0] - 48;
        const ph = A4[1] - 48;
        const scale = Math.min(pw / img.width, ph / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const page = out.addPage(A4);
        page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: rgb(1, 1, 1) });
        page.drawImage(img, {
          x: (A4[0] - w) / 2,
          y: (A4[1] - h) / 2,
          width: w,
          height: h,
        });
      } catch {
        throw err("imageCorrupt", e.file.name);
      }
    }
    done++;
    onProgress(5 + Math.round((done / entries.length) * 90));
  }

  onProgress(98);
  return out.save({ useObjectStreams: true });
}

/* ── component ─────────────────────────────────────────────────────────── */

export function PageManager() {
  const { t, num } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [srcFile, setSrcFile] = useState<File | null>(null);
  const pages = useEditorHistory<PageEntry[]>([]);
  const entries = pages.state;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"empty" | "loading" | "ready">("empty");
  const [loadPct, setLoadPct] = useState(0);
  const [busy, setBusy] = useState<"" | "export" | "extract">("");
  const [busyPct, setBusyPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);
  const urlsRef = useRef<string[]>([]);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const trackUrl = useCallback((u: string) => {
    if (u) urlsRef.current.push(u);
  }, []);

  const revokeAll = useCallback(() => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
  }, []);

  useEffect(() => revokeAll, [revokeAll]);

  /* ── intake ── */
  const loadFile = useCallback(
    async (file: File) => {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        toast.error(err("givePdf").message);
        return;
      }
      revokeAll();
      pages.reset([]);
      setSelected(new Set());
      setSrcFile(file);
      setPhase("loading");
      setLoadPct(0);
      const signal = { cancelled: false };
      cancelRef.current = signal;
      const collected: PageEntry[] = [];
      // NOTE: entries are pushed by index while the pool renders in parallel
      try {
        await renderThumbs(
          file,
          (idx, baseRot, thumb) => {
            trackUrl(thumb);
            collected[idx] = {
              id: uid(),
              kind: "pdf",
              srcIdx: idx,
              baseRot,
              rot: 0,
              thumb,
            };
          },
          setLoadPct,
          signal
        );
        if (signal.cancelled) return;
        pages.reset(collected);
        setPhase("ready");
      } catch {
        if (!signal.cancelled) {
          toast.error(err("pdfLoadFail").message);
          setPhase("empty");
          setSrcFile(null);
        }
      }
    },
    [revokeAll, trackUrl, pages]
  );

  useEffect(() => {
    // stop pending thumbnail renders when navigating away
    return () => {
      if (cancelRef.current) cancelRef.current.cancelled = true;
    };
  }, []);

  // unified undo/redo (Day 7)
  useUndoRedoKeys(pages);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void loadFile(f);
  };

  /* ── entry ops (every mutation = one undo point) ── */
  // NOTE: object-URLs are NOT revoked on entry removal — undo may bring the
  // entry back. URLs live until the file is reloaded / editor unmounts.
  const updateEntries = (fn: (prev: PageEntry[]) => PageEntry[]) => {
    pages.set(fn);
  };

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeSelected = () => {
    if (selected.size === 0) return toast.error(t("pmNeedSelect"));
    if (selected.size >= entries.length) return toast.error(t("pmNeedPage"));
    updateEntries((prev) => prev.filter((e) => !selected.has(e.id)));
    setSelected(new Set());
  };

  const rotateSelected = (dir: 1 | -1) => {
    if (selected.size === 0) return toast.error(t("pmNeedSelect"));
    updateEntries((prev) =>
      prev.map((e) =>
        selected.has(e.id) ? { ...e, rot: stepRot(e.rot, dir) } : e
      )
    );
  };

  const moveEntry = (id: string, dir: -1 | 1) => {
    updateEntries((prev) => {
      const i = prev.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const dropOn = (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    updateEntries((prev) => {
      const fi = prev.findIndex((e) => e.id === from);
      const ti = prev.findIndex((e) => e.id === targetId);
      if (fi < 0 || ti < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  };

  const lastSelIndex = useMemo(() => {
    let last = -1;
    entries.forEach((e, i) => {
      if (selected.has(e.id)) last = i;
    });
    return last;
  }, [entries, selected]);

  const insertAt = () => (lastSelIndex >= 0 ? lastSelIndex + 1 : entries.length);

  const addBlank = () => {
    const e: PageEntry = { id: uid(), kind: "blank", w: A4[0], h: A4[1], rot: 0, thumb: "" };
    updateEntries((prev) => {
      const next = [...prev];
      next.splice(insertAt(), 0, e);
      return next;
    });
  };

  const addImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imgs: PageEntry[] = [];
    let failed = 0;
    for (const f of Array.from(files)) {
      if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp)$/i.test(f.name)) {
        failed++;
        continue;
      }
      const thumb = await new Promise<string>((res) => {
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          const s = Math.min(1, THUMB_BOX / Math.max(img.width, img.height));
          c.width = Math.max(1, Math.round(img.width * s));
          c.height = Math.max(1, Math.round(img.height * s));
          c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob((b) => {
            if (b) {
              URL.revokeObjectURL(url);
              res(URL.createObjectURL(b));
            } else {
              res(url);
            }
          }, "image/jpeg", 0.72);
        };
        img.onerror = () => res("");
        img.src = url;
      });
      trackUrl(thumb);
      imgs.push({ id: uid(), kind: "image", file: f, rot: 0, thumb });
    }
    if (imgs.length) {
      updateEntries((prev) => {
        const next = [...prev];
        next.splice(insertAt(), 0, ...imgs);
        return next;
      });
      toast.success(`${num(imgs.length)} ${t("pmImgAdded")}`);
    }
    if (failed) toast.error(`${num(failed)} ${t("pmImgFailCount")}`);
    if (imgInputRef.current) imgInputRef.current.value = "";
  };

  /* ── export / extract ── */
  const buildSubset = (subset: PageEntry[], pctBase: number) =>
    buildPdf(srcFile, subset, (pct) => setBusyPct(pctBase + Math.round(pct * (100 - pctBase) / 100)));

  const doExport = async () => {
    if (!srcFile || entries.length === 0) return;
    setBusy("export");
    setBusyPct(0);
    try {
      const bytes = await buildSubset(entries, 0);
      downloadBlob(
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
        safeName(`${stripExt(srcFile.name)}-arranged.pdf`)
      );
      toast.success(t("pmSaved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("genericErr"));
    } finally {
      setBusy("");
    }
  };

  const doExtract = async () => {
    if (selected.size === 0) return toast.error(t("pmNeedSelect"));
    if (!srcFile) return;
    const subset = entries.filter((e) => selected.has(e.id));
    setBusy("extract");
    setBusyPct(0);
    try {
      const bytes = await buildSubset(subset, 0);
      downloadBlob(
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
        safeName(`${stripExt(srcFile.name)}-extracted.pdf`)
      );
      toast.success(t("pmExtractDone"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("genericErr"));
    } finally {
      setBusy("");
    }
  };

  const hasSelection = selected.size > 0;

  const toolBtn = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    disabled = false,
    tone: "default" | "danger" = "default"
  ) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || busy !== ""}
      onClick={onClick}
      className={`h-11 gap-1.5 rounded-xl border-border/70 bg-white text-xs font-semibold ${
        tone === "danger"
          ? "text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          : "text-emerald-700 hover:bg-emerald-50"
      } dark:bg-white/5 dark:text-emerald-300 dark:hover:bg-emerald-500/10`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

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
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/30">
          <LayoutGrid className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold sm:text-xl">{t("pmTitle")}</h1>
          <p className="truncate text-xs text-muted-foreground">{t("pmTagline")}</p>
        </div>
        {phase === "ready" && (
          <Button
            onClick={doExport}
            disabled={busy !== "" || entries.length === 0}
            className="h-11 gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-lg shadow-emerald-500/30 hover:from-emerald-600 hover:to-teal-700"
          >
            {busy === "export" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileOutput className="h-4 w-4" />
            )}
            {busy === "export" ? t("pmSaving") : t("pmSave")}
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label={t("pmAddAria")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*,.png,.jpg,.jpeg,.webp"
        multiple
        className="sr-only"
        aria-label={t("pmAddImg")}
        onChange={(e) => void addImages(e.target.files)}
      />

      {/* empty / loading state */}
      {phase !== "ready" && (
        <div
          role="button"
          tabIndex={0}
          aria-label={t("pmAddAria")}
          onClick={() => phase === "empty" && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (phase !== "empty") return;
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
          onDrop={onDrop}
          className={`flex min-h-[320px] cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed bg-white/60 p-8 text-center transition dark:bg-white/5 ${
            dragOver ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-500/10" : "border-border"
          }`}
        >
          {phase === "loading" ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-emerald-600 dark:text-emerald-400" />
              <p className="font-semibold">{t("pmLoading")}</p>
              <div className="w-full max-w-xs">
                <Progress value={loadPct} aria-label={t("progressAria")} />
              </div>
            </>
          ) : (
            <>
              <UploadCloud className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
              <p className="text-lg font-bold">{t("pmEmpty")}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{t("pmEmptyHint")}</p>
            </>
          )}
        </div>
      )}

      {/* workspace */}
      {phase === "ready" && (
        <>
          {/* toolbar */}
          <div className="fm-card mb-4 flex flex-wrap items-center gap-2 rounded-2xl p-3">
            <span className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {num(selected.size)} {t("pmSelected")}
            </span>
            {toolBtn(<CheckSquare className="h-4 w-4" />, t("pmSelectAll"), () =>
              setSelected(new Set(entries.map((e) => e.id)))
            )}
            {toolBtn(
              <Undo2 className="h-4 w-4" />,
              t("urUndo"),
              pages.undo,
              !pages.canUndo
            )}
            {toolBtn(
              <Redo2 className="h-4 w-4" />,
              t("urRedo"),
              pages.redo,
              !pages.canRedo
            )}
            {toolBtn(<Square className="h-4 w-4" />, t("pmSelectNone"), () => setSelected(new Set()), !hasSelection)}
            {toolBtn(
              <Trash2 className="h-4 w-4" />,
              t("pmDelete"),
              removeSelected,
              !hasSelection,
              "danger"
            )}
            {toolBtn(<RotateCcw className="h-4 w-4" />, t("pmRotateL"), () => rotateSelected(-1), !hasSelection)}
            {toolBtn(<RotateCw className="h-4 w-4" />, t("pmRotateR"), () => rotateSelected(1), !hasSelection)}
            {toolBtn(<FileOutput className="h-4 w-4" />, t("pmExtract"), doExtract, !hasSelection || busy !== "")}
            {toolBtn(<FilePlus2 className="h-4 w-4" />, t("pmBlank"), addBlank, busy !== "")}
            {toolBtn(<ImagePlus className="h-4 w-4" />, t("pmAddImg"), () => imgInputRef.current?.click(), busy !== "")}
            <span className="ms-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {t("pmPrivacy")}
            </span>
          </div>

          {(busy === "export" || busy === "extract") && (
            <div className="mb-4">
              <Progress value={busyPct} aria-label={t("progressAria")} />
            </div>
          )}

          {entries.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("pmNeedPage")}</p>
          ) : (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
              onDragOver={(e) => e.preventDefault()}
            >
              {entries.map((e, i) => {
                const sel = selected.has(e.id);
                return (
                  <div
                    key={e.id}
                    role="checkbox"
                    aria-checked={sel}
                    tabIndex={0}
                    aria-label={t("pmCardAria")}
                    onClick={() => toggleSel(e.id)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        toggleSel(e.id);
                      }
                    }}
                    onDragOver={(ev) => ev.preventDefault()}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      dropOn(e.id);
                    }}
                    className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 bg-white transition dark:bg-white/5 ${
                      sel
                        ? "border-emerald-500 shadow-lg shadow-emerald-500/20"
                        : "border-border hover:border-emerald-400/60"
                    }`}
                  >
                    {/* selection check */}
                    <span
                      className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                        sel
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-white/80 bg-black/30 text-transparent"
                      }`}
                    >
                      <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                    </span>

                    {/* page label */}
                    <span className="absolute right-2 top-2 z-10 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-bold text-white">
                      {e.kind === "pdf"
                        ? `${t("pmPageN")} ${num(i + 1)}`
                        : e.kind === "blank"
                          ? t("pmBlankLabel")
                          : t("pmImgLabel")}
                    </span>

                    {/* thumb */}
                    <button
                      type="button"
                      draggable
                      onDragStart={() => (dragId.current = e.id)}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleSel(e.id);
                      }}
                      aria-label={`${t("pmGripAria")} — ${t("pmCardAria")}`}
                      className="block w-full cursor-grab active:cursor-grabbing"
                    >
                      {e.thumb ? (
                        <img
                          src={e.thumb}
                          alt=""
                          className="pointer-events-none aspect-[3/4] w-full bg-slate-100 object-contain dark:bg-white/10"
                          style={{ transform: e.rot ? `rotate(${e.rot}deg)` : undefined }}
                        />
                      ) : (
                        <span className="flex aspect-[3/4] w-full items-center justify-center bg-slate-100 text-[11px] font-semibold text-slate-400 dark:bg-white/10 dark:text-slate-500">
                          {e.kind === "blank" ? t("pmBlankLabel") : "…"}
                        </span>
                      )}
                    </button>

                    {/* actions */}
                    <div className="flex items-center justify-between gap-0.5 border-t border-border/60 p-1 dark:border-white/10">
                      <span className="flex items-center text-muted-foreground">
                        <GripVertical className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={t("pmMoveUpAria")}
                          disabled={i === 0}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            moveEntry(e.id, -1);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("pmMoveDownAria")}
                          disabled={i === entries.length - 1}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            moveEntry(e.id, 1);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("pmRotAria")}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            updateEntries((prev) =>
                              prev.map((x) =>
                                x.id === e.id ? { ...x, rot: stepRot(x.rot, 1) } : x
                              )
                            );
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("pmDelAria")}
                          disabled={entries.length <= 1}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            updateEntries((prev) => prev.filter((x) => x.id !== e.id));
                            setSelected((prev) => {
                              const n = new Set(prev);
                              n.delete(e.id);
                              return n;
                            });
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 dark:hover:bg-rose-500/10"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {srcFile ? `${srcFile.name} · ${formatBytes(srcFile.size)} · ` : ""}
            {t("pmDragHint")}
          </p>
        </>
      )}
    </div>
  );
}
