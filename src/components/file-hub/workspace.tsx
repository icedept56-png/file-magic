"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Download,
  File as FileIcon,
  FileDown,
  Loader2,
  RotateCcw,
  SearchX,
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
import type { OutputFile, ToolOptionField } from "@/lib/tools/types";
import { useAppStore } from "@/store/app-store";

type OptValue = string | number | boolean;
type Opts = Record<string, OptValue>;

export function Workspace() {
  const activeToolId = useAppStore((s) => s.activeToolId);
  const goHome = useAppStore((s) => s.goHome);

  const tool = useMemo(() => getTool(activeToolId ?? ""), [activeToolId]);

  const [files, setFiles] = useState<File[]>([]);
  const [opts, setOpts] = useState<Opts>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [results, setResults] = useState<OutputFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zipping, setZipping] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const defaultOpts = (t: NonNullable<typeof tool>): Opts =>
    Object.fromEntries(t.options.map((o) => [o.key, o.default ?? ""] as const));

  // Reset everything when the active tool changes
  useEffect(() => {
    if (!tool) return;
    setFiles([]);
    setOpts(defaultOpts(tool));
    setResults(null);
    setError(null);
    setProgress(0);
    setProgressLabel("");
    setBusy(false);
    setZipping(false);
  }, [activeToolId]);

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
      toast.error(
        tool.inputMode === "text" ? "আগে লেখা দিন" : "প্রথমে ফাইল যোগ করুন"
      );
      return;
    }
    setBusy(true);
    setError(null);
    setResults(null);
    setProgress(0);
    setProgressLabel("");
    try {
      const out = await tool.process(files, { ...opts }, (pct, label) => {
        setProgress(Math.min(100, Math.max(0, pct)));
        if (label) setProgressLabel(label);
      });
      if (!out?.length) throw new Error("কোনো ফাইল তৈরি হয়নি");
      setResults(out);
      toast.success("সফলভাবে সম্পন্ন হয়েছে!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "কিছু একটা সমস্যা হয়েছে";
      setError(msg);
      toast.error(msg);
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
      toast.success("ZIP ফাইল তৈরি হয়েছে");
    } catch {
      toast.error("ZIP তৈরি করা যায়নি");
    } finally {
      setZipping(false);
    }
  };

  const resetAll = () => {
    setFiles([]);
    if (tool) setOpts(defaultOpts(tool));
    setResults(null);
    setError(null);
    setProgress(0);
    setProgressLabel("");
  };

  /* ── fallback: unknown tool ─────────────────────────────────────────── */
  if (!tool) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={goHome}
          className="text-zinc-300 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          সব টুল
        </Button>
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-6 py-16 text-center backdrop-blur-sm">
          <SearchX className="mx-auto h-10 w-10 text-zinc-600" />
          <p className="mt-4 font-medium text-zinc-300">
            টুলটি খুঁজে পাওয়া যায়নি
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            সম্ভবত লিংকটি পুরোনো — হোম থেকে আবার একটি টুল বেছে নিন।
          </p>
        </div>
      </section>
    );
  }

  const textareaFields = tool.options.filter((f) => f.type === "textarea");
  const settingFields = tool.options.filter((f) => f.type !== "textarea");

  const renderField = (f: ToolOptionField) => {
    switch (f.type) {
      case "select":
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <Label className="text-xs text-zinc-400">{f.label}</Label>
            <Select
              value={String(opts[f.key] ?? f.default ?? "")}
              onValueChange={(v) => setOpt(f.key, v)}
            >
              <SelectTrigger className="w-full border-white/10 bg-white/[0.05]">
                <SelectValue placeholder="বাছুন" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-[#0d0d17]">
                {f.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
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
              <Label className="text-xs text-zinc-400">{f.label}</Label>
              <span className="ml-auto rounded-md bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-fuchsia-400">
                {Number(opts[f.key] ?? f.default ?? f.min ?? 0)}
                {f.unit ?? ""}
              </span>
            </div>
            <Slider
              min={f.min}
              max={f.max}
              step={f.step}
              value={[Number(opts[f.key] ?? f.default ?? f.min ?? 0)]}
              onValueChange={(vals) => setOpt(f.key, vals[0] ?? 0)}
              aria-label={f.label}
            />
          </div>
        );
      case "number":
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <Label className="text-xs text-zinc-400">{f.label}</Label>
            <Input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              placeholder={f.placeholder}
              value={String(opts[f.key] ?? "")}
              onChange={(e) =>
                setOpt(f.key, e.target.value === "" ? "" : Number(e.target.value))
              }
              className="border-white/10 bg-white/[0.05] placeholder:text-zinc-600"
            />
          </div>
        );
      case "checkbox":
        return (
          <div
            key={f.key}
            className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5"
          >
            <Label className="text-xs text-zinc-400">{f.label}</Label>
            <Switch
              checked={!!opts[f.key]}
              onCheckedChange={(v) => setOpt(f.key, v)}
              aria-label={f.label}
            />
          </div>
        );
      case "text":
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <Label className="text-xs text-zinc-400">{f.label}</Label>
            <Input
              type="text"
              placeholder={f.placeholder}
              value={String(opts[f.key] ?? "")}
              onChange={(e) => setOpt(f.key, e.target.value)}
              className="border-white/10 bg-white/[0.05] placeholder:text-zinc-600"
            />
          </div>
        );
      case "textarea":
        return (
          <div key={f.key} className="col-span-full flex flex-col gap-2">
            <Label className="text-xs text-zinc-400">{f.label}</Label>
            <Textarea
              rows={6}
              placeholder={f.placeholder}
              value={String(opts[f.key] ?? "")}
              onChange={(e) => setOpt(f.key, e.target.value)}
              className="resize-y border-white/10 bg-white/[0.05] placeholder:text-zinc-600"
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
        className="text-zinc-300 hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        সব টুল
      </Button>

      <div className="mt-4 flex items-center gap-4">
        <span
          className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${tool.gradient}`}
          style={{ boxShadow: `0 8px 24px -8px ${tool.glow}` }}
        >
          <tool.icon className="h-7 w-7 text-white" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-zinc-50">{tool.name}</h1>
          <p className="mt-0.5 text-sm text-zinc-400">{tool.desc}</p>
        </div>
      </div>

      {/* main card */}
      <div className="mt-6 flex flex-col gap-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-sm sm:p-6">
        {/* dropzone */}
        {tool.inputMode !== "text" && (
          <div
            role="button"
            tabIndex={0}
            aria-label="ফাইল যোগ করুন"
            onClick={openFilePicker}
            onKeyDown={handleDropzoneKeyDown}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer?.files ?? null);
            }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center outline-none transition-all focus-visible:ring-2 focus-visible:ring-fuchsia-500/60 ${
              dragging
                ? "scale-[1.01] border-fuchsia-400 bg-fuchsia-500/10"
                : "border-white/15 bg-white/[0.03] hover:border-fuchsia-400/50 hover:bg-white/[0.05]"
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
              <UploadCloud className="mx-auto h-10 w-10 text-fuchsia-400" />
            </motion.div>
            <p className="mt-3 font-medium text-zinc-200">
              ফাইল টেনে আনুন অথবা ক্লিক করুন
            </p>
            <p className="mt-1 text-xs text-zinc-500">{tool.hint}</p>
            <p className="mt-2 text-[11px] text-zinc-600">
              {tool.files.multiple ? "একাধিক ফাইল দেওয়া যাবে" : "একটি ফাইল দিন"}
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
              {files.map((f, i) => (
                <motion.div
                  key={`${f.name}-${f.size}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2"
                >
                  <FileIcon className="h-4 w-4 shrink-0 text-fuchsia-400" />
                  <span className="flex-1 truncate text-sm text-zinc-200">
                    {f.name}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatBytes(f.size)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(i)}
                    aria-label="সরান"
                    className="h-7 w-7 shrink-0 text-zinc-500 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
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
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">
              সেটিংস
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {settingFields.map(renderField)}
            </div>
          </div>
        )}

        {/* progress */}
        {busy && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="flex items-center justify-center gap-2 text-xs text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progressLabel || "কাজ চলছে..."}
            </p>
          </div>
        )}

        {/* error */}
        {error && !busy && (
          <Alert
            variant="destructive"
            className="border-red-500/30 bg-red-500/10 text-red-300"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>সমস্যা হয়েছে</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* action */}
        <Button
          onClick={runProcess}
          disabled={!canProcess || busy}
          className="h-12 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-orange-400 text-base font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              কাজ চলছে...
            </>
          ) : (
            <>
              <Wand2 className="h-5 w-5" />
              {tool.actionLabel}
            </>
          )}
        </Button>

        {/* results */}
        {results && !busy && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="fm-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                <CheckCircle2 className="relative h-5 w-5" />
              </span>
              সম্পন্ন! নিচের ফাইলগুলো ডাউনলোড করুন
            </div>

            <div className="space-y-2">
              {results.map((r, i) => (
                <div
                  key={`${r.name}-${i}`}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2"
                >
                  <FileDown className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="flex-1 truncate text-sm text-zinc-200">
                    {r.name}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatBytes(r.blob.size)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => downloadBlob(r.blob, r.name)}
                    className="shrink-0 border border-white/10 bg-white/10 text-zinc-100 hover:bg-white/20"
                  >
                    <Download className="h-4 w-4" />
                    ডাউনলোড
                  </Button>
                </div>
              ))}
            </div>

            {results.length > 1 && (
              <Button
                variant="outline"
                onClick={downloadAllAsZip}
                disabled={zipping}
                className="h-11 w-full border-white/15 bg-white/[0.03] text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                {zipping ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    ZIP তৈরি হচ্ছে...
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" />
                    সব ডাউনলোড (ZIP)
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
            className="w-full text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            নতুন কাজ শুরু করুন
          </Button>
        )}
      </div>
    </section>
  );
}
