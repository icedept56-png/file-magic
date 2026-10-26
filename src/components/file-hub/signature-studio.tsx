"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUser,
  Loader2,
  PenLine,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { downloadBlob, safeName, stripExt } from "@/lib/tools/helpers";
import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";
import { SignaturePad } from "./signature-pad";

/**
 * সিগনেচার স্টুডিও (Day 19 — 60-day roadmap): place draw/typed/image
 * signatures on ANY document — PDF pages or images — 100% client-side.
 */

interface Stamp {
  id: number;
  dataUrl: string;
  /** position + width, as fractions of the page */
  x: number;
  y: number;
  w: number;
  page: number;
}

type Doc =
  | { kind: "pdf"; bytes: Uint8Array; numPages: number; name: string }
  | { kind: "image"; bitmap: ImageBitmap; name: string; w: number; h: number };

export function SignatureStudio() {
  const { t, num } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [page, setPage] = useState(0); // 0-based
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [pct, setPct] = useState(0);

  const viewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const nextId = useRef(1);

  /* ── intake ── */
  const accept = "application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp,.heic";

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const bytes = new Uint8Array(await file.arrayBuffer());
        const d = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        setDoc({ kind: "pdf", bytes, numPages: d.numPages, name: file.name });
        setPage(0);
        setStamps([]);
      } else {
        const { ensureDecoded } = await import("@/lib/tools/processors/formats");
        const dec = await ensureDecoded(file);
        const bmp = await createImageBitmap(dec);
        setDoc({ kind: "image", bitmap: bmp, name: file.name, w: bmp.width, h: bmp.height });
        setPage(0);
        setStamps([]);
      }
    } catch {
      toast.error(t("genericErr"));
    } finally {
      setBusy(false);
    }
  };

  /* ── render current page/image into the canvas ── */
  const renderPage = useCallback(async () => {
    const c = canvasRef.current;
    const view = viewRef.current;
    if (!c || !view || !doc) return;
    setRendering(true);
    try {
      if (doc.kind === "image") {
        const maxW = 900;
        const scale = Math.min(maxW / doc.w, 1);
        c.width = Math.round(doc.w * scale);
        c.height = Math.round(doc.h * scale);
        c.getContext("2d")!.drawImage(doc.bitmap, 0, 0, c.width, c.height);
      } else {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const d = await pdfjs.getDocument({ data: doc.bytes.slice() }).promise;
        const pg = await d.getPage(page + 1);
        const maxW = 900;
        const base = pg.getViewport({ scale: 1 });
        const vs = pg.getViewport({ scale: Math.min(maxW / base.width, 1.6) });
        c.width = Math.round(vs.width);
        c.height = Math.round(vs.height);
        await pg.render({ canvasContext: c.getContext("2d")!, viewport: vs }).promise;
      }
    } catch {
      toast.error(t("genericErr"));
    } finally {
      setRendering(false);
    }
  }, [doc, page, t]);

  useEffect(() => {
    void renderPage();
  }, [renderPage]);

  /* ── stamps ── */
  const addStamp = (dataUrl: string) => {
    setSigOpen(false);
    haptic("light");
    setStamps((s) => [
      ...s,
      { id: nextId.current++, dataUrl, x: 0.5, y: 0.62, w: 0.26, page: doc?.kind === "pdf" ? page : 0 },
    ]);
    toast.success(t("sgPlaced"));
  };

  const onStampPointerDown = (e: React.PointerEvent, s: Stamp) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic/automation pointers have no active id — dragging still works
         because move/up are handled on the container */
    }
    const view = viewRef.current!;
    const r = view.getBoundingClientRect();
    const self = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      id: s.id,
      dx: (e.clientX - self.left) / r.width,
      dy: (e.clientY - self.top) / r.height,
    };
    setSelected(s.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const view = viewRef.current;
    if (!d || !view) return;
    const r = view.getBoundingClientRect();
    const x = Math.min(0.98, Math.max(0, (e.clientX - r.left) / r.width - d.dx));
    const y = Math.min(0.98, Math.max(0, (e.clientY - r.top) / r.height - d.dy));
    setStamps((ss) => ss.map((s) => (s.id === d.id ? { ...s, x, y } : s)));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const sel = stamps.find((s) => s.id === selected) ?? null;

  /* ── export ── */
  const exportOut = async () => {
    if (!doc || stamps.length === 0) return;
    setBusy(true);
    setPct(10);
    try {
      if (doc.kind === "pdf") {
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.load(doc.bytes.slice());
        setPct(35);
        // render each signature PNG once, embed per page
        const cache = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>();
        for (const s of stamps) {
          if (!cache.has(s.dataUrl)) cache.set(s.dataUrl, await pdf.embedPng(s.dataUrl));
          const img = cache.get(s.dataUrl)!;
          const pg = pdf.getPage(Math.min(s.page, pdf.getPageCount() - 1));
          const { width: pw, height: ph } = pg.getSize();
          const w = s.w * pw;
          const h = w * 0.4; // pad aspect ≈ 680×280
          pg.drawImage(img, {
            x: s.x * pw - w / 2,
            y: ph - s.y * ph - h / 2,
            width: w,
            height: h,
          });
        }
        setPct(75);
        const out = await pdf.save();
        downloadBlob(new Blob([out as BlobPart], { type: "application/pdf" }), `${stripExt(safeName(doc.name))}-signed.pdf`);
        toast.success(t("sgDonePdf"));
        haptic("success");
      } else {
        const c = canvasRef.current!;
        const ctx = c.getContext("2d")!;
        for (const s of stamps) {
          const img = new Image();
          await new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej();
            img.src = s.dataUrl;
          });
          const w = s.w * c.width;
          const h = w * 0.4;
          ctx.drawImage(img, s.x * c.width - w / 2, s.y * c.height - h / 2, w, h);
        }
        setPct(80);
        const out = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
        downloadBlob(out, `${stripExt(safeName(doc.name))}-signed.png`);
        toast.success(t("sgDoneImg"));
        haptic("success");
      }
    } catch {
      toast.error(t("genericErr"));
    } finally {
      setBusy(false);
      setPct(0);
    }
  };

  const dropStamps = stamps.filter((s) => s.page === page);

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-10 pt-4 sm:px-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={goHome} aria-label={t("backHomeAria")} className="h-11 w-11 rounded-xl">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/30">
          <FileUser className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-emerald-950 sm:text-xl">{t("sgTitle")}</h1>
          <p className="truncate text-xs text-emerald-900/55">{t("sgSub")}</p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-emerald-900/50 md:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {t("bsPrivacy")}
        </span>
        {doc && (
          <Button
            onClick={() => setSigOpen(true)}
            className="h-10 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-md shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
          >
            <PenLine className="h-4 w-4" />
            {t("sgAddSig")}
          </Button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={t("sgPickAria")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />

      {/* intake */}
      {!doc && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={t("sgPickAria")}
            className="w-full rounded-2xl border-2 border-dashed border-emerald-600/25 bg-emerald-50/40 p-10 text-center transition hover:border-emerald-500/60 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {busy ? (
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-500" />
            ) : (
              <FileUser className="mx-auto h-10 w-10 text-emerald-500" />
            )}
            <p className="mt-3 font-semibold text-emerald-950/85">{t("sgPick")}</p>
            <p className="mt-1 text-xs text-emerald-900/55">{t("sgPickHint")}</p>
          </button>
          <div className="fm-card mt-4 rounded-2xl p-4 text-sm leading-relaxed text-emerald-900/70">
            <p className="font-semibold text-emerald-950">{t("sgHowTitle")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>{t("sgHow1")}</li>
              <li>{t("sgHow2")}</li>
              <li>{t("sgHow3")}</li>
            </ol>
          </div>
        </motion.div>
      )}

      {/* workspace */}
      {doc && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          {/* page view */}
          <div className="fm-card rounded-2xl p-3">
            <div
              ref={viewRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative overflow-auto"
            >
              <div className="relative mx-auto w-fit">
                {rendering && <div className="absolute inset-0 z-10 grid place-items-center bg-white/60"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>}
                <canvas ref={canvasRef} className="block max-w-full rounded-lg shadow-sm" aria-label={t("sgDocAria")} />
                {/* stamps overlay */}
                {dropStamps.map((s) => (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${t("sgSigAria")} ${num(s.id)}`}
                    onPointerDown={(e) => onStampPointerDown(e, s)}
                    onKeyDown={(e) => {
                      if (e.key === "Delete" || e.key === "Backspace") {
                        setStamps((ss) => ss.filter((x) => x.id !== s.id));
                        setSelected(null);
                      }
                    }}
                    className={`absolute cursor-move touch-none rounded-lg border-2 border-dashed transition-colors ${
                      selected === s.id ? "border-emerald-500 bg-emerald-500/5" : "border-transparent hover:border-emerald-500/40"
                    }`}
                    style={{
                      left: `${s.x * 100}%`,
                      top: `${s.y * 100}%`,
                      width: `${s.w * 100}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {/* plain img: data URLs only, no next/image optimization needed */}
                    <img src={s.dataUrl} alt="" className="pointer-events-none w-full" draggable={false} />
                  </div>
                ))}
              </div>
            </div>

            {/* page nav (pdf) */}
            {doc.kind === "pdf" && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label={t("sgPrev")}
                  className="h-10 w-10 rounded-xl border-emerald-900/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-16 text-center text-sm font-semibold text-emerald-950">
                  {num(page + 1)} / {num(doc.numPages)}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page >= doc.numPages - 1}
                  onClick={() => setPage((p) => Math.min(doc.numPages - 1, p + 1))}
                  aria-label={t("sgNext")}
                  className="h-10 w-10 rounded-xl border-emerald-900/10"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* side panel */}
          <div className="fm-card space-y-4 rounded-2xl p-4">
            <Button
              variant="outline"
              onClick={() => setSigOpen(true)}
              className="h-11 w-full gap-1.5 border-emerald-600/25 font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              <Plus className="h-4 w-4" />
              {t("sgAddSig")}
            </Button>

            {sel ? (
              <>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <Label2>{t("sgSize")}</Label2>
                    <button
                      type="button"
                      onClick={() => {
                        setStamps((ss) => ss.filter((x) => x.id !== sel.id));
                        setSelected(null);
                      }}
                      className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("sgRemoveSig")}
                    </button>
                  </div>
                  <Slider
                    value={[Math.round(sel.w * 100)]}
                    min={8}
                    max={60}
                    step={1}
                    thumbLabel={t("sgSize")}
                    thumbValueText={(v) => `${v}%`}
                    onValueChange={([v]) =>
                      setStamps((ss) => ss.map((s) => (s.id === sel.id ? { ...s, w: v / 100 } : s)))
                    }
                  />
                  <p className="mt-1 text-right text-xs text-emerald-900/50">{num(Math.round(sel.w * 100))}%</p>
                </div>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-emerald-900/55">{t("sgSelectHint")}</p>
            )}

            <div className="border-t border-emerald-900/[0.07] pt-3">
              <p className="text-xs font-semibold text-emerald-900/60">
                {t("sgStamps")}: {num(dropStamps.length)}{doc.kind === "pdf" ? ` · ${t("sgOnPage")} ${num(page + 1)}` : ""}
              </p>
            </div>

            <Button
              onClick={() => void exportOut()}
              disabled={busy || stamps.length === 0}
              className="h-12 w-full bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-md shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {busy ? `${pct}%` : doc.kind === "pdf" ? t("sgExportPdf") : t("sgExportImg")}
            </Button>
          </div>
        </div>
      )}

      {/* signature dialog */}
      <Dialog open={sigOpen} onOpenChange={setSigOpen}>
        <DialogContent className="rounded-2xl bg-white sm:max-w-lg" role="dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-950">
              <PenLine className="h-5 w-5 text-emerald-600" />
              {t("sgDialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("sgDialogSub")}</DialogDescription>
          </DialogHeader>
          <SignaturePad onInsert={addStamp} />
          <button
            type="button"
            onClick={() => setSigOpen(false)}
            aria-label={t("ofDismiss")}
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-emerald-900/40 hover:bg-emerald-600/10 hover:text-emerald-700"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Label2({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold text-emerald-950/80">{children}</span>;
}
