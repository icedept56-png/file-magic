"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  Download,
  File as FileIcon,
  FileDown,
  FileSpreadsheet,
  FileText,
  FileType2,
  ImageIcon,
  Info,
  Loader2,
  Music,
  Package,
  Printer,
  RotateCcw,
  SearchX,
  Share2,
  ShieldCheck,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { downloadBlob, formatBytes } from "@/lib/tools/helpers";
import { getTool } from "@/lib/tools/registry";
import { checkOutput, preflightInputs } from "@/lib/tools/validate";
import { recordActivity } from "@/lib/recents";
import { canShareFile, isPrintable, printBlob, shareFile, waShareLink } from "@/lib/share";
import { haptic } from "@/lib/haptics";
import { pick, useT } from "@/lib/i18n";
import type { OutputFile, ToolOptionField } from "@/lib/tools/types";
import { useAppStore } from "@/store/app-store";

type OptValue = string | number | boolean;
type Opts = Record<string, OptValue>;

/** pick a matching icon + tint for a file, by extension */
function fileVisual(name: string): { Icon: typeof FileIcon; className: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return { Icon: FileText, className: "text-rose-500" };
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(ext))
    return { Icon: ImageIcon, className: "text-fuchsia-500" };
  if (["doc", "docx", "txt", "md", "html", "htm"].includes(ext))
    return { Icon: FileType2, className: "text-orange-500" };
  if (["xls", "xlsx", "csv"].includes(ext))
    return { Icon: FileSpreadsheet, className: "text-emerald-500" };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext))
    return { Icon: Package, className: "text-teal-500" };
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext))
    return { Icon: Music, className: "text-cyan-500" };
  return { Icon: FileIcon, className: "text-emerald-700/60" };
}

export function Workspace() {
  const { t, num, lang } = useT();
  const activeToolId = useAppStore((s) => s.activeToolId);
  const goHome = useAppStore((s) => s.goHome);

  const tool = useMemo(() => getTool(activeToolId ?? ""), [activeToolId]);

  const [files, setFiles] = useState<File[]>([]);
  const [opts, setOpts] = useState<Opts>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [results, setResults] = useState<OutputFile[] | null>(null);
  const [checks, setChecks] = useState<boolean[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zipping, setZipping] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  const defaultOpts = (t2: NonNullable<typeof tool>): Opts =>
    Object.fromEntries(t2.options.map((o) => [o.key, o.default ?? ""] as const));

  // Reset everything when the active tool changes — and if the user came
  // from recent activity ("চালিয়ে যাওয়া"), pre-fill their previous options
  useEffect(() => {
    if (!tool) return;
    const base = defaultOpts(tool);
    const resume = useAppStore.getState().resumeOpts;
    if (resume && resume.toolId === tool.id) {
      for (const f of tool.options) {
        if (f.key in resume.opts && resume.opts[f.key] !== "") base[f.key] = resume.opts[f.key];
      }
      useAppStore.getState().setResumeOpts(null);
    }
    setFiles([]);
    setOpts(base);
    setResults(null);
    setChecks(null);
    setError(null);
    setProgress(0);
    setProgressLabel("");
    setBusy(false);
    setZipping(false);
  }, [tool]);

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

  const addFiles = (list: FileList | null) => {
    if (!tool || !list || list.length === 0) return;
    const arr = Array.from(list);
    setFiles((prev) => (tool.files.multiple ? [...prev, ...arr] : [arr[0]]));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const setOpt = (key: string, value: OptValue) => {
    setOpts((prev) => ({ ...prev, [key]: value }));
  };

  const openFilePicker = () => inputRef.current?.click();

  const handleDropzoneKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  };

  const minFiles = tool
    ? (tool.files.min ?? (tool.inputMode === "file" ? 1 : 0))
    : 0;
  const filesOk = tool ? files.length >= minFiles : false;
  const textVal = String(opts["text"] ?? "").trim();
  const needsText = tool
    ? tool.inputMode === "text" ||
      (tool.inputMode === "both" && files.length === 0)
    : false;
  const textOk = !tool
    ? false
    : tool.inputMode === "file"
      ? true
      : needsText
        ? textVal.length > 0
        : true;
  const canProcess = filesOk && textOk;

  const runProcess = async () => {
    if (!tool) return;
    if (!canProcess) {
      toast.error(tool.inputMode === "text" ? t("needText") : t("needFile"));
      return;
    }
    // Day 11 pre-flight: reject empty / disguised files with a friendly,
    // file-naming error BEFORE any processing starts
    if (files.length > 0) {
      try {
        await preflightInputs(files);
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("genericErr");
        setError(msg);
        toast.error(msg);
        return;
      }
    }
    setBusy(true);
    setError(null);
    setResults(null);
    setChecks(null);
    setProgress(0);
    setProgressLabel("");
    try {
      const out = await tool.process(files, { ...opts }, (pct, label) => {
        setProgress(Math.min(100, Math.max(0, pct)));
        if (label) setProgressLabel(label);
      });
      if (!out?.length) throw new Error(t("noOutputErr"));
      setResults(out);
      toast.success(t("doneToast"));
      haptic("success");
      // Day 14: remember this run (metadata only — never file contents) so
      // the home screen can offer "চালিয়ে যাওয়া" (resume) later
      void recordActivity({
        toolId: tool.id,
        names: files.slice(0, 4).map((f) => f.name),
        count: files.length,
        bytes: files.reduce((a, f) => a + f.size, 0),
        outputs: out.length,
        opts: { ...opts },
        text: needsText ? textVal.slice(0, 5000) : undefined,
      });
      // Day 11: locally verify every output (magic bytes vs name, non-empty)
      // and attach per-row trust badges — the user sees proof, not promises
      void (async () => {
        try {
          const list = await Promise.all(out.map((r) => checkOutput(r.name, r.blob)));
          setChecks(list.map((c) => c === "ok"));
        } catch {
          /* leave rows unchecked rather than block the result */
        }
      })();
      // bring the fresh results into view
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("genericErr");
      setError(msg);
      toast.error(msg);
      haptic("error");
    } finally {
      setBusy(false);
      setProgressLabel("");
    }
  };

  const downloadAllAsZip = async () => {
    if (!results || results.length === 0 || !tool) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      for (const r of results) {
        let name = r.name || "file";
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
        zip.file(name, r.blob);
      }
      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      downloadBlob(zipBlob, `${tool.id}-files.zip`);
      toast.success(t("zipDoneToast"));
    } catch {
      toast.error(t("zipFailToast"));
    } finally {
      setZipping(false);
    }
  };

  const resetAll = () => {
    setFiles([]);
    if (tool) setOpts(defaultOpts(tool));
    setResults(null);
    setChecks(null);
    setError(null);
    setProgress(0);
    setProgressLabel("");
  };

  // Day 20: share (native file share → WhatsApp fallback) + print
  const shareResult = async (r: OutputFile) => {
    const file = new File([r.blob], r.name, { type: r.blob.type || "application/octet-stream" });
    if (canShareFile(file)) {
      const res = await shareFile(file, t("shText"), r.name);
      if (res === "shared" || res === "cancelled") return;
    }
    window.open(waShareLink(`${t("shText")} — ${r.name}`), "_blank", "noopener,noreferrer");
    toast.info(t("shFallback"));
  };

  const printResult = (r: OutputFile) => {
    const res = printBlob(r.blob, r.name);
    if (res === "blocked") toast.error(t("shPopBlock"));
    else toast.success(t("shPrintPop"));
  };

  /* ── fallback: unknown tool ─────────────────────────────────────────── */
  if (!tool) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={goHome}
          className="text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("allTools")}
        </Button>
        <div className="fm-card mt-6 rounded-2xl px-6 py-16 text-center">
          <SearchX className="mx-auto h-10 w-10 text-emerald-700/30" />
          <p className="mt-4 font-semibold text-emerald-950/80">{t("toolNotFound")}</p>
          <p className="mt-1 text-sm text-emerald-900/55">{t("toolNotFoundHint")}</p>
        </div>
      </section>
    );
  }

  const textareaFields = tool.options.filter((f) => f.type === "textarea");
  const settingFields = tool.options.filter((f) => f.type !== "textarea");

  // overall size delta shown in the success banner (only when output is smaller)
  const totalIn = files.reduce((s, f) => s + f.size, 0);
  const totalOut = results?.reduce((s, r) => s + r.blob.size, 0) ?? 0;
  const savedPct =
    totalIn > 0 && totalOut > 0 && totalOut < totalIn
      ? Math.round(((totalIn - totalOut) / totalIn) * 100)
      : 0;

  const renderField = (f: ToolOptionField) => {
    const label = pick(lang, f.label, f.labelEn);
    const placeholder = pick(lang, f.placeholder ?? "", f.placeholderEn ?? "") || undefined;
    switch (f.type) {
      case "select":
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <Label className="text-xs text-emerald-900/70">{label}</Label>
            <Select
              value={String(opts[f.key] ?? f.default ?? "")}
              onValueChange={(v) => setOpt(f.key, v)}
            >
              <SelectTrigger className="w-full border-emerald-900/10 bg-white shadow-sm">
                <SelectValue placeholder={t("chooseOne")} />
              </SelectTrigger>
              <SelectContent className="border-emerald-600/15 bg-white shadow-lg">
                {f.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {pick(lang, o.label, o.labelEn)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case "range":
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <div className="flex items-center">
              <Label className="text-xs text-emerald-900/70">{label}</Label>
              <span className="ml-auto rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {num(Number(opts[f.key] ?? f.default ?? f.min ?? 0))}
                {f.unit ?? ""}
              </span>
            </div>
            <Slider
              min={f.min}
              max={f.max}
              step={f.step}
              value={[Number(opts[f.key] ?? f.default ?? f.min ?? 0)]}
              onValueChange={(vals) => setOpt(f.key, vals[0] ?? 0)}
              aria-label={label}
            />
          </div>
        );
      case "number":
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <Label className="text-xs text-emerald-900/70">{label}</Label>
            <Input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              placeholder={placeholder}
              value={String(opts[f.key] ?? "")}
              onChange={(e) =>
                setOpt(f.key, e.target.value === "" ? "" : Number(e.target.value))
              }
              className="border-emerald-900/10 bg-white shadow-sm placeholder:text-emerald-900/35"
            />
          </div>
        );
      case "checkbox":
        return (
          <div
            key={f.key}
            className="flex items-center justify-between rounded-xl border border-emerald-900/[0.07] bg-white px-3 py-2.5 shadow-sm"
          >
            <Label className="text-xs text-emerald-900/70">{label}</Label>
            <Switch
              checked={!!opts[f.key]}
              onCheckedChange={(v) => setOpt(f.key, v)}
              aria-label={label}
            />
          </div>
        );
      case "text":
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <Label className="text-xs text-emerald-900/70">{label}</Label>
            <Input
              type="text"
              placeholder={placeholder}
              value={String(opts[f.key] ?? "")}
              onChange={(e) => setOpt(f.key, e.target.value)}
              className="border-emerald-900/10 bg-white shadow-sm placeholder:text-emerald-900/35"
            />
          </div>
        );
      case "textarea":
        return (
          <div key={f.key} className="col-span-full flex flex-col gap-2">
            <Label className="text-xs text-emerald-900/70">{label}</Label>
            <Textarea
              rows={6}
              placeholder={placeholder}
              value={String(opts[f.key] ?? "")}
              onChange={(e) => setOpt(f.key, e.target.value)}
              className="resize-y border-emerald-900/10 bg-white shadow-sm placeholder:text-emerald-900/35"
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* header */}
      <Button
        variant="ghost"
        size="sm"
        onClick={goHome}
        className="text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("allTools")}
      </Button>

      <div className="mt-4 flex items-center gap-4">
        <span
          className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl shadow-lg ${tool.gradient}`}
        >
          <tool.icon className="h-7 w-7 text-white" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-emerald-950">
            {pick(lang, tool.name, tool.nameEn)}
          </h1>
          <p className="mt-0.5 text-sm text-emerald-900/60">
            {pick(lang, tool.desc, tool.descEn)}
          </p>
        </div>
      </div>

      {/* main card */}
      <div className="fm-card mt-6 flex flex-col gap-6 rounded-2xl p-5 sm:p-6">
        {/* dropzone */}
        {tool.inputMode !== "text" && (
          <div
            role="button"
            tabIndex={0}
            aria-label={t("addFileAria")}
            onClick={openFilePicker}
            onKeyDown={handleDropzoneKeyDown}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => {
              e.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragLeave={() => {
              // depth counting: child elements fire dragleave too — flicker fix
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              addFiles(e.dataTransfer?.files ?? null);
            }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              dragging
                ? "scale-[1.01] border-emerald-500 bg-emerald-500/[0.07]"
                : "border-emerald-600/25 bg-emerald-50/40 hover:border-emerald-500/60 hover:bg-emerald-50"
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
              <UploadCloud className="mx-auto h-10 w-10 text-emerald-500" />
            </motion.div>
            <p className="mt-3 font-semibold text-emerald-950/85">{t("dropHere")}</p>
            <p className="mt-1 text-xs text-emerald-900/55">
              {pick(lang, tool.hint, tool.hintEn)}
            </p>
            <p className="mt-2 text-[11px] text-emerald-900/40">
              {tool.files.multiple ? t("multipleOk") : t("oneOnly")}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={tool.files.accept}
              multiple={tool.files.multiple}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              // programmatic .click() bubbles up to the dropzone and would
              // re-trigger the dialog — stop it here
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {/* file list */}
        {files.length > 0 && (
          <div className="fm-scroll max-h-64 space-y-2 overflow-y-auto">
            <AnimatePresence initial={false}>
              {files.map((f, i) => {
                const visual = fileVisual(f.name);
                return (
                  <motion.div
                    key={`${f.name}-${f.size}-${i}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-3 rounded-xl border border-emerald-900/[0.07] bg-white px-3 py-2 shadow-sm"
                  >
                    <visual.Icon className={`h-4 w-4 shrink-0 ${visual.className}`} />
                    <span className="flex-1 truncate text-sm text-emerald-950/85">
                      {f.name}
                    </span>
                    <span className="shrink-0 text-xs text-emerald-900/50">
                      {formatBytes(f.size)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(i)}
                      aria-label={t("remove")}
                      className="h-7 w-7 shrink-0 text-emerald-900/40 hover:bg-emerald-600/10 hover:text-emerald-800"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* text inputs (textarea options) */}
        {textareaFields.length > 0 && (
          <div className="grid grid-cols-1 gap-4">
            {textareaFields.map(renderField)}
          </div>
        )}

        {/* settings */}
        {settingFields.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-bold text-emerald-950/80">
              {t("settings")}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {settingFields.map(renderField)}
            </div>
          </div>
        )}

        {/* progress */}
        {busy && (
          <div className="space-y-2" role="status" aria-live="polite">
            <Progress
              value={progress}
              className="h-2 bg-emerald-100 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-500"
            />
            <p className="flex items-center justify-center gap-2 text-xs text-emerald-900/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
              {progressLabel || t("working")}
              <span className="font-semibold text-emerald-700">
                {num(Math.round(progress))}%
              </span>
            </p>
          </div>
        )}

        {/* error */}
        {error && !busy && (
          <Alert
            variant="destructive"
            className="border-red-500/25 bg-red-50 text-red-700"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("errTitle")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* large-file heads-up (Day 9) — heavy ops run in a Web Worker */}
        {!busy && files.some((f) => f.size > 25 * 1024 * 1024) && (
          <p className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("lfLarge")}
          </p>
        )}

        {/* action */}
        <Button
          onClick={runProcess}
          disabled={!canProcess || busy}
          className="btn-shine h-12 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("working")}
            </>
          ) : (
            <>
              <Wand2 className="h-5 w-5" />
              {pick(lang, tool.actionLabel, tool.actionLabelEn)}
            </>
          )}
        </Button>

        {/* results */}
        {results && !busy && (
          <motion.div
            ref={resultsRef}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-3"
          >
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="fm-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                {/* Day 21: check mark draws itself in — small premium cue */}
                <svg viewBox="0 0 24 24" className="relative h-5 w-5" fill="none" aria-hidden="true">
                  <motion.circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="#059669"
                    strokeWidth="2.2"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                  <motion.path
                    d="m7.5 12.5 3 3 6-6.5"
                    stroke="#059669"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.35, delay: 0.3, ease: "easeOut" }}
                  />
                </svg>
              </span>
              {t("doneBanner")}
              {savedPct > 0 && (
                <span className="ml-auto rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                  {num(savedPct)}% {t("smallerBy")}
                </span>
              )}
            </div>

            <div className="fm-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
              {results.map((r, i) => {
                const ok = checks?.[i];
                return (
                <motion.div
                  key={`${r.name}-${i}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(i * 0.05, 0.4) }}
                  className="flex items-center gap-3 rounded-xl border border-emerald-900/[0.07] bg-white px-3 py-2 shadow-sm"
                >
                  {ok === false ? (
                    <AlertTriangle
                      className="h-4 w-4 shrink-0 text-amber-600"
                      aria-label={t("qaBadHint")}
                    />
                  ) : (
                    <FileDown className="h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                  <span className="flex-1 truncate text-sm text-emerald-950/85">
                    {r.name}
                  </span>
                  <span className="shrink-0 text-xs text-emerald-900/50">
                    {formatBytes(r.blob.size)}
                  </span>
                  {ok === true && (
                    <span
                      title={t("qaVerifiedAria")}
                      aria-label={t("qaVerifiedAria")}
                      className="hidden shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 sm:inline-flex dark:bg-emerald-500/15 dark:text-emerald-300"
                    >
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      {t("qaVerified")}
                    </span>
                  )}
                  {ok === false && (
                    <span
                      title={t("qaBadHint")}
                      className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 sm:inline-flex dark:bg-amber-500/15 dark:text-amber-300"
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {t("qaBad")}
                    </span>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void shareResult(r)}
                    aria-label={t("shShareAria")}
                    title={t("shShareAria")}
                    className="h-9 w-9 shrink-0 rounded-lg text-emerald-900/55 hover:bg-emerald-600/10 hover:text-emerald-700"
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                  {isPrintable(r.blob.type) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => printResult(r)}
                      aria-label={t("shPrintAria")}
                      title={t("shPrintAria")}
                      className="hidden h-9 w-9 shrink-0 rounded-lg text-emerald-900/55 hover:bg-emerald-600/10 hover:text-emerald-700 sm:inline-flex"
                    >
                      <Printer className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => downloadBlob(r.blob, r.name)}
                    className="shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/25 hover:brightness-105"
                  >
                    <Download className="h-4 w-4" />
                    {t("download")}
                  </Button>
                </motion.div>
                );
              })}
            </div>

            {results.length > 1 && (
              <Button
                variant="outline"
                onClick={downloadAllAsZip}
                disabled={zipping}
                className="h-11 w-full border-emerald-600/20 bg-white text-emerald-800 shadow-sm hover:bg-emerald-50 hover:text-emerald-900"
              >
                {zipping ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("zipMaking")}
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4 text-emerald-600" />
                    {t("downloadAllZip")}
                  </>
                )}
              </Button>
            )}
          </motion.div>
        )}

        {/* reset */}
        {(results || error) && !busy && (
          <Button
            variant="ghost"
            onClick={resetAll}
            className="w-full text-emerald-900/55 hover:bg-emerald-600/10 hover:text-emerald-800"
          >
            <RotateCcw className="h-4 w-4" />
            {t("startFresh")}
          </Button>
        )}
      </div>
    </section>
  );
}
