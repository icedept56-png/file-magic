"use client";

/* ═══════════════════════════════════════════════════════════════════════
   OCR Studio — Day 2 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Scanned images / phone photos / PDFs → editable Bengali+English text.
   100% client-side: tesseract.js engine, worker, core and language data
   are self-hosted from /tesseract/* and /tessdata/* (no CDN, works with
   the PWA's offline posture; first-run data is cached by the browser).

   Pipeline:
     files → jobs (images = 1 job, PDF = 1 job per page, cap 30)
     per job (sequential, live progress):
       prepare  — image → canvas (≥1400px long edge, EXIF-safe)
                — PDF → pdf.js page render at ~2× (≈2000px wide)
       run      — tesseract recognize(canvas) → text
     results → editable combined text → copy / .txt / .docx

   Scanner hand-off: the document scanner stages processed pages as
   File[] in the app store (ocrHandoff); this view picks them up on
   mount so a scan can flow straight into text.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CircleAlert,
  Copy,
  Download,
  FileText,
  Images,
  Loader2,
  ScanText,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { downloadBlob, safeName, stripExt } from "@/lib/tools/helpers";
import { useAppStore } from "@/store/app-store";

/* ── types ─────────────────────────────────────────────────────────────── */

type LangChoice = "ben+eng" | "ben" | "eng";
type JobStatus = "queued" | "preparing" | "running" | "done" | "empty" | "failed";

type Job = {
  id: string;
  name: string;
  kind: "image" | "pdf";
  /** 1-based page number inside the source PDF (images: always 1) */
  pageIdx: number;
  pageTotal: number;
  status: JobStatus;
  progress: number;
  text: string;
  /** transient canvas — nulled right after recognition to bound memory */
  canvas: HTMLCanvasElement | null;
};

type TessWorker = {
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

type TessLoggerMsg = { status: string; progress: number };
type TessGlobal = {
  createWorker: (
    langs: string,
    oem: number,
    opts: {
      workerPath: string;
      corePath: string;
      langPath: string;
      logger?: (m: TessLoggerMsg) => void;
    },
  ) => Promise<TessWorker>;
};

type PdfJsDoc = Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>;

const ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.bmp,.pdf,application/pdf";
const OCR_TARGET_W = 1800; // rendered width for PDF pages / upscaled photos
const PDF_PAGE_CAP = 30;

const uid = () => Math.random().toString(36).slice(2, 10);

/* ── engine loading (script-tag keeps the bundler untouched) ──────────── */

function loadEngine(): Promise<TessGlobal> {
  const w = window as unknown as { Tesseract?: TessGlobal };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/tesseract/tesseract.min.js";
    s.onload = () => {
      if (w.Tesseract) res(w.Tesseract);
      else rej(new Error("engine-missing"));
    };
    s.onerror = () => rej(new Error("engine-load-failed"));
    document.head.appendChild(s);
  });
}

/* ── page preparation ──────────────────────────────────────────────────── */

/** image file → canvas at OCR-friendly resolution */
async function imageToCanvas(file: File): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    bmp = await createImageBitmap(file);
  }
  const scale = Math.min(3, Math.max(1, OCR_TARGET_W / Math.max(bmp.width, bmp.height)));
  // downscale big photos, upscale small ones (OCR wants ≈1800px long edge)
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** pdf page → rendered canvas */
async function pdfPageToCanvas(doc: PdfJsDoc, pageIdx: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageIdx);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1, OCR_TARGET_W / base.width));
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext("2d")!, viewport: vp } as never).promise;
  return c;
}

/* ── component ─────────────────────────────────────────────────────────── */

export function OcrStudio() {
  const { t, num, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);
  const openTool = useAppStore((s) => s.openTool);
  const ocrHandoff = useAppStore((s) => s.ocrHandoff);
  const setOcrHandoff = useAppStore((s) => s.setOcrHandoff);

  /* jobs */
  const [jobs, setJobs] = useState<Job[]>([]);
  const [phase, setPhase] = useState<"idle" | "engine" | "running" | "done">("idle");
  const [langChoice, setLangChoice] = useState<LangChoice>("ben+eng");
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [editedText, setEditedText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /* refs */
  const fileRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef<Job[]>([]);
  const workerRef = useRef<TessWorker | null>(null);
  const workerLangRef = useRef<LangChoice | null>(null);
  const currentJobRef = useRef<string | null>(null);
  const pdfDocsRef = useRef<Map<string, PdfJsDoc>>(new Map());
  const abortRef = useRef(false);
  jobsRef.current = jobs;

  /* hand-off from the document scanner: pick up staged files once */
  const handoffDone = useRef(false);
  useEffect(() => {
    if (handoffDone.current) return;
    handoffDone.current = true;
    if (ocrHandoff.length) {
      void addFiles(ocrHandoff);
      setOcrHandoff([]);
    }
  }, []);

  /* cleanup: kill worker + pdf docs on unmount */
  useEffect(
    () => () => {
      abortRef.current = true;
      void workerRef.current?.terminate();
      pdfDocsRef.current.forEach((d) => d.destroy().catch(() => {}));
      pdfDocsRef.current.clear();
    },
    [],
  );

  /* ── file intake ───────────────────────────────────────────────────── */

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (!files.length) return;
      const supported = files.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
      if (!supported.length) {
        toast.error(t("ocrUnsupported"));
        return;
      }
      let capped = false;
      const next: Job[] = [];
      for (const f of supported) {
        if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
          try {
            const pdfjs = await import("pdfjs-dist");
            pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
            const total = Math.min(doc.numPages, PDF_PAGE_CAP);
            if (doc.numPages > PDF_PAGE_CAP) capped = true;
            const id = uid();
            pdfDocsRef.current.set(id, doc);
            for (let p = 1; p <= total; p++) {
              next.push({
                id: `${id}:${p}`,
                name: f.name,
                kind: "pdf",
                pageIdx: p,
                pageTotal: total,
                status: "queued",
                progress: 0,
                text: "",
                canvas: null,
              });
            }
          } catch {
            toast.error(t("ocrUnsupported"));
          }
        } else {
          const id = uid();
          fileMap().set(id, f);
          next.push({
            id,
            name: f.name,
            kind: "image",
            pageIdx: 1,
            pageTotal: 1,
            status: "queued",
            progress: 0,
            text: "",
            canvas: null,
          });
        }
      }
      if (next.length) {
        setJobs((j) => [...j, ...next]);
        setPhase("idle");
        setEditedText(null);
      }
      if (capped) toast.warning(t("ocrTooMany"));
    },
    [t],
  );

  const removeJob = (id: string) => {
    if (phase === "running" || phase === "engine") return;
    const base = id.split(":")[0];
    const next = jobsRef.current.filter((j) => j.id !== id);
    // destroy the pdf doc when its last page row is removed
    if (pdfDocsRef.current.has(base) && !next.some((j) => j.id.startsWith(`${base}:`))) {
      pdfDocsRef.current.get(base)!.destroy().catch(() => {});
      pdfDocsRef.current.delete(base);
    }
    setJobs(next);
    setEditedText(null);
    setPhase("idle");
  };

  const clearAll = () => {
    if (phase === "running" || phase === "engine") return;
    pdfDocsRef.current.forEach((d) => d.destroy().catch(() => {}));
    pdfDocsRef.current.clear();
    setJobs([]);
    setEditedText(null);
    setPhase("idle");
  };

  /* ── the OCR run ───────────────────────────────────────────────────── */

  const patchJob = (id: string, patch: Partial<Job>) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const getWorker = async (): Promise<TessWorker> => {
    if (workerRef.current && workerLangRef.current === langChoice) return workerRef.current;
    if (workerRef.current) {
      await workerRef.current.terminate().catch(() => {});
      workerRef.current = null;
    }
    setProgressLabel(t("ocrLoadData"));
    const T = await loadEngine();
    const worker = await T.createWorker(langChoice, 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tessdata",
      logger: (m) => {
        if (m.status === "recognizing text" && currentJobRef.current) {
          patchJob(currentJobRef.current, { progress: Math.round(m.progress * 100) });
        }
      },
    });
    workerRef.current = worker;
    workerLangRef.current = langChoice;
    return worker;
  };

  const runOcr = async () => {
    if (!jobsRef.current.length) return;
    abortRef.current = false;
    setEditedText(null);
    setJobs((js) => js.map((j) => ({ ...j, status: "queued" as JobStatus, progress: 0 })));
    let doneCount = 0;
    let failCount = 0;
    let engineFailed = false;
    try {
      setPhase("engine");
      await getWorker();
      setPhase("running");
      setProgressLabel(null);
      for (const job of jobsRef.current) {
        if (abortRef.current) break;
        currentJobRef.current = job.id;
        try {
          patchJob(job.id, { status: "preparing", progress: 0, text: "" });
          let canvas: HTMLCanvasElement | null = null;
          if (job.kind === "image") {
            const file = fileMap().get(job.id);
            if (!file) throw new Error("source-missing");
            canvas = await imageToCanvas(file);
          } else {
            const [base] = job.id.split(":");
            const doc = pdfDocsRef.current.get(base);
            if (!doc) throw new Error("source-missing");
            canvas = await pdfPageToCanvas(doc, job.pageIdx);
          }
          patchJob(job.id, { status: "running" });
          const { data } = await workerRef.current!.recognize(canvas);
          const text = (data.text ?? "").replace(/[ \t]+\n/g, "\n").trim();
          patchJob(job.id, { status: text ? "done" : "empty", progress: 100, text, canvas: null });
          if (text) doneCount++;
        } catch {
          patchJob(job.id, { status: "failed", progress: 0, canvas: null });
          failCount++;
        }
      }
      setPhase(doneCount > 0 ? "done" : "idle");
      if (failCount && doneCount) toast.warning(t("ocrFailed"));
      else if (failCount) toast.error(t("ocrFailed"));
      else if (doneCount) toast.success(t("ocrDone"));
    } catch {
      engineFailed = true;
      setPhase("idle");
      toast.error(t("ocrEngineFail"));
    } finally {
      currentJobRef.current = null;
      setProgressLabel(null);
      if (engineFailed) {
        await workerRef.current?.terminate().catch(() => {});
        workerRef.current = null;
        workerLangRef.current = null;
      }
    }
  };

  /* combined text for the editor panel */
  const combined = (() => {
    const done = jobs.filter((j) => j.status === "done" && j.text);
    if (!done.length) return "";
    const multi = done.length > 1;
    return done
      .map((j) => {
        const label = multi ? (lang === "en" ? `${j.name} — page ${j.pageIdx}` : `${j.name} — পাতা ${j.pageIdx}`) : "";
        return (label ? `${label}\n` : "") + j.text;
      })
      .join("\n\n");
  })();

  useEffect(() => {
    if (phase === "done" && editedText === null) setEditedText(combined);
  }, [phase]);

  const wordCount = (editedText ?? combined).trim() ? (editedText ?? combined).trim().split(/\s+/).length : 0;
  const busy = phase === "engine" || phase === "running";
  const hasResults = jobs.some((j) => j.status === "done");

  /* ── actions ───────────────────────────────────────────────────────── */

  const outName = () => stripExt(safeName(jobs[0]?.name || "ocr")) || "ocr";

  const copyText = async () => {
    const text = editedText ?? combined;
    if (!text) {
      toast.error(t("ocrNoText"));
      return;
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    toast.success(t("ocrCopied"));
  };

  const downloadTxt = () => {
    const text = editedText ?? combined;
    if (!text) {
      toast.error(t("ocrNoText"));
      return;
    }
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${outName()}-ocr.txt`);
    toast.success(t("ocrDone"));
  };

  const downloadDocx = async () => {
    const text = editedText ?? combined;
    if (!text) {
      toast.error(t("ocrNoText"));
      return;
    }
    try {
      const { Document, Packer, Paragraph, TextRun } = await import("docx");
      const paras = text
        .split("\n")
        .map((line) => new Paragraph({ children: [new TextRun(line || " ")] }));
      const doc = new Document({ sections: [{ children: paras }] });
      downloadBlob(await Packer.toBlob(doc), `${outName()}-ocr.docx`);
      toast.success(t("ocrDone"));
    } catch {
      toast.error(t("ocrFailed"));
    }
  };

  /* ── empty state ───────────────────────────────────────────────────── */

  if (!jobs.length) {
    return (
      <div className="flex min-h-screen flex-col" lang={lang}>
        <header className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={goHome} aria-label={t("brandName")} className="h-11 w-11">
            <BackIcon />
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-lg font-bold">
              <ScanText className="h-5 w-5 text-lime-600" aria-hidden />
              {t("ocrTitle")}
            </h1>
            <p className="truncate text-xs text-muted-foreground">{t("ocrTagline")}</p>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles(e.dataTransfer.files);
            }}
            className="flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-white/15 bg-white/[0.03] p-8 text-center"
          >
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-lime-500 to-emerald-600 shadow-lg shadow-lime-500/30">
              <UploadCloud className="h-9 w-9 text-white" aria-hidden />
            </div>
            <div>
              <p className="text-base font-semibold">{t("ocrEmpty")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("ocrEmptyHint")}</p>
            </div>
            <Button
              size="lg"
              onClick={() => fileRef.current?.click()}
              className="h-12 bg-gradient-to-r from-lime-500 to-emerald-600 px-6 font-semibold text-white shadow-lime-500/30 hover:from-lime-400 hover:to-emerald-500"
            >
              <Images className="mr-2 h-5 w-5" aria-hidden />
              {t("ocrEmpty")}
            </Button>
          </motion.div>
        </main>

        <p className="mt-auto px-4 pb-6 text-center text-xs text-muted-foreground">{t("footerLine")}</p>

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-label={t("ocrAddAria")}
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  /* ── studio ────────────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-screen flex-col" lang={lang}>
      <header className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
        <Button variant="ghost" size="icon" onClick={goHome} aria-label={t("brandName")} className="h-11 w-11 shrink-0">
          <BackIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-base font-bold sm:text-lg">
            <ScanText className="h-5 w-5 shrink-0 text-lime-600" aria-hidden />
            {t("ocrTitle")}
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">{t("ocrTagline")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !jobs.some((j) => j.status !== "done")}
            onClick={() => void runOcr()}
            className="h-11 bg-gradient-to-r from-lime-500 to-emerald-600 px-4 font-semibold text-white shadow-lime-500/25 hover:from-lime-400 hover:to-emerald-500"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ScanText className="mr-2 h-4 w-4" aria-hidden />}
            {busy ? t("ocrRunning") : hasResults ? t("ocrRetry") : t("ocrStart")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={clearAll} className="h-11 px-3">
            <X className="mr-1 h-4 w-4" aria-hidden />
            {t("remove")}
          </Button>
        </div>
      </header>

      {progressLabel && (
        <div className="mx-auto w-full max-w-6xl px-3 sm:px-4">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-lime-500/30 bg-lime-500/10 px-3 py-2 text-sm text-lime-800 dark:text-lime-300">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            {progressLabel}
          </div>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-3 pb-4 sm:px-4 lg:flex-row">
        {/* job list */}
        <section className="w-full shrink-0 lg:w-80" aria-label={t("ocrTitle")}>
          <div className="mb-3 flex items-center justify-between">
            <Label className="text-sm font-semibold">
              {t("ocrLang")}
            </Label>
            <div className="flex gap-1" role="radiogroup" aria-label={t("ocrLang")}>
              {(
                [
                  { key: "ben+eng", label: t("ocrLangBoth") },
                  { key: "ben", label: t("ocrLangBn") },
                  { key: "eng", label: t("ocrLangEn") },
                ] as { key: LangChoice; label: string }[]
              ).map((o) => {
                const active = langChoice === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={busy}
                    onClick={() => setLangChoice(o.key)}
                    className={`h-9 rounded-lg border px-2.5 text-xs font-semibold transition ${
                      active
                        ? "border-lime-500/60 bg-lime-500/20 text-lime-800 dark:text-lime-300"
                        : "border-white/10 bg-white/[0.04] text-foreground/70 hover:bg-white/[0.08]"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[62vh]">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center">
                  {j.status === "done" ? (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-lime-500/20 text-lime-700 dark:text-lime-400">
                      <Check className="h-4 w-4" aria-hidden />
                    </span>
                  ) : j.status === "running" || j.status === "preparing" ? (
                    <Loader2 className="h-5 w-5 animate-spin text-lime-600" aria-hidden />
                  ) : j.status === "failed" ? (
                    <CircleAlert className="h-5 w-5 text-red-500" aria-hidden />
                  ) : j.status === "empty" ? (
                    <CircleAlert className="h-5 w-5 text-amber-500" aria-hidden />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-semibold text-foreground/60">
                      {num(j.pageIdx)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {j.kind === "pdf" ? `${j.name} · ${t("ocrPageOf")} ${num(j.pageIdx)}` : j.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {j.status === "done"
                      ? `${num(j.text.split(/\s+/).filter(Boolean).length)} ${t("ocrWords")}`
                      : j.status === "running"
                        ? `${num(j.progress)}%`
                        : j.status === "empty"
                          ? t("ocrNoText")
                          : j.status === "preparing"
                            ? t("ocrPreparing")
                            : j.status === "failed"
                              ? t("ocrFailed")
                              : t("ocrQueued")}
                  </p>
                  {j.status === "running" && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={j.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-gradient-to-r from-lime-500 to-emerald-500 transition-all" style={{ width: `${j.progress}%` }} />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeJob(j.id)}
                  disabled={busy}
                  aria-label={`${t("remove")} — ${j.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>

          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} className="mt-3 h-11 w-full">
            <Images className="mr-2 h-4 w-4" aria-hidden />
            {t("ocrAddAria")}
          </Button>
        </section>

        {/* text panel */}
        <section className="flex min-h-[40vh] flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:min-h-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Label className="text-sm font-semibold">
              {t("ocrStart")} {wordCount > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">· {num(wordCount)} {t("ocrWords")}</span>}
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy || !combined} onClick={() => void copyText()} className="h-9 px-3">
                {copied ? <Check className="mr-1 h-4 w-4" aria-hidden /> : <Copy className="mr-1 h-4 w-4" aria-hidden />}
                {copied ? t("ocrCopied") : t("ocrCopy")}
              </Button>
              <Button variant="outline" size="sm" disabled={busy || !combined} onClick={downloadTxt} className="h-9 px-3">
                <Download className="mr-1 h-4 w-4" aria-hidden />
                {t("ocrTxt")}
              </Button>
              <Button
                size="sm"
                disabled={busy || !combined}
                onClick={() => void downloadDocx()}
                className="h-9 bg-gradient-to-r from-lime-500 to-emerald-600 px-3 font-semibold text-white hover:from-lime-400 hover:to-emerald-500"
              >
                <FileText className="mr-1 h-4 w-4" aria-hidden />
                {t("ocrDocx")}
              </Button>
            </div>
          </div>
          {hasResults ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{t("ocrEditHint")}</p>
              <textarea
                value={editedText ?? combined}
                onChange={(e) => setEditedText(e.target.value)}
                spellCheck={false}
                lang={lang}
                aria-label={t("ocrStart")}
                className="min-h-[30vh] flex-1 resize-none rounded-xl border border-white/10 bg-background/60 p-4 font-mono text-sm leading-relaxed text-foreground outline-none transition focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20 lg:min-h-0"
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
              {busy ? (
                <span className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-lime-600" aria-hidden />
                  {phase === "engine" ? t("ocrLoadData") : t("ocrRunning")}
                </span>
              ) : (
                t("ocrEmptyHint")
              )}
            </div>
          )}
        </section>
      </main>

      <p className="mt-auto px-4 py-4 text-center text-xs text-muted-foreground">{t("footerLine")}</p>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        aria-label={t("ocrAddAria")}
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* keep uploaded image files addressable during the run without state churn */
declare global {
  interface Window {
    __ocrFiles?: Map<string, File>;
  }
}
const fileMap = (): Map<string, File> => {
  if (!window.__ocrFiles) window.__ocrFiles = new Map();
  return window.__ocrFiles;
};

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}
