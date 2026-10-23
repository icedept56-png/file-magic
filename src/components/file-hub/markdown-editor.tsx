"use client";

/* Markdown Editor — ফাইল ম্যাজিক
 * Welcome dropzone → two-pane editor (textarea + live react-markdown preview)
 * → client-side exports: MD / styled HTML / rasterized PDF / parsed DOCX.
 * Bengali-safe: PDF export rasterizes the preview DOM (html2canvas-pro),
 * DOCX is UTF-8 XML by nature. */

import { useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  ArrowLeft,
  Bold,
  Code,
  Eye,
  FileCode2,
  FileText,
  FileType,
  FileType2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  Loader2,
  PenLine,
  Quote,
  Table,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
import { downloadBlob, stripExt } from "@/lib/tools/helpers";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { Paragraph as DocxParagraph, TextRun as DocxTextRun } from "docx";

/* ── helpers ─────────────────────────────────────────────────────────── */

type BusyKind = "md" | "html" | "pdf" | "docx";
type Pane = "editor" | "preview";

const ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";
const MD_TABLE = "| Column | Column | Column |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** minimal standalone HTML document (emerald accents, Bengali-capable fonts) */
function buildStandaloneHtml(body: string, title: string): string {
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 16px 80px; background: #f4faf6; color: #062b1d;
    font-family: "Hind Siliguri", "Noto Sans Bengali", -apple-system, BlinkMacSystemFont,
      "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.75; }
  main { max-width: 42rem; margin: 0 auto; background: #fff; border: 1px solid rgba(5,150,105,.14);
    border-radius: 16px; padding: 36px 30px; box-shadow: 0 10px 30px -14px rgba(13,31,22,.18); }
  h1, h2, h3, h4, h5, h6 { color: #022c22; line-height: 1.3; margin: 1.6em 0 .6em; }
  h1 { font-size: 2em; border-bottom: 2px solid rgba(5,150,105,.18); padding-bottom: .3em; }
  h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
  p { margin: .8em 0; }
  a { color: #047857; text-decoration: underline; }
  blockquote { margin: 1em 0; padding: .4em 1em; border-left: 4px solid #34d399;
    background: #ecfdf5; color: #065f46; font-style: italic; border-radius: 0 8px 8px 0; }
  code { background: #ecfdf5; border-radius: 6px; padding: .15em .4em; font-size: .9em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #022c22; color: #ecfdf5; padding: 16px 18px; border-radius: 12px; overflow-x: auto; }
  pre code { background: transparent; color: inherit; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #a7f3d0; padding: .5em .75em; text-align: left; }
  th { background: #ecfdf5; color: #022c22; }
  img { max-width: 100%; border-radius: 12px; }
  hr { border: none; border-top: 1px solid rgba(5,150,105,.22); margin: 2em 0; }
  ul, ol { padding-left: 1.5em; } li { margin: .3em 0; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/* ── react-markdown component styling (emerald palette) ──────────────── */

const mdComponents: Components = {
  h1: ({ node, ...props }) => <h1 {...props} className="mb-3 mt-8 text-2xl font-extrabold tracking-tight text-emerald-950 sm:text-3xl" />,
  h2: ({ node, ...props }) => <h2 {...props} className="mb-2.5 mt-7 text-xl font-bold tracking-tight text-emerald-950 sm:text-2xl" />,
  h3: ({ node, ...props }) => <h3 {...props} className="mb-2 mt-6 text-lg font-bold text-emerald-950 sm:text-xl" />,
  h4: ({ node, ...props }) => <h4 {...props} className="mb-2 mt-5 text-base font-bold text-emerald-950" />,
  h5: ({ node, ...props }) => <h5 {...props} className="mb-2 mt-5 text-sm font-bold text-emerald-950" />,
  h6: ({ node, ...props }) => <h6 {...props} className="mb-2 mt-5 text-sm font-bold text-emerald-900/80" />,
  p: ({ node, ...props }) => <p {...props} className="my-3 leading-relaxed text-emerald-950/90" />,
  ul: ({ node, ...props }) => <ul {...props} className="my-3 list-disc space-y-1 pl-6 marker:text-emerald-500" />,
  ol: ({ node, ...props }) => <ol {...props} className="my-3 list-decimal space-y-1 pl-6 marker:text-emerald-600" />,
  li: ({ node, ...props }) => <li {...props} className="leading-relaxed text-emerald-950/90" />,
  blockquote: ({ node, ...props }) => (
    <blockquote {...props} className="my-4 border-l-4 border-emerald-400 pl-4 italic text-emerald-900/70" />
  ),
  code: ({ node, className, ...props }) => (
    <code
      {...props}
      className={cn(
        "rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[0.9em] text-emerald-900",
        "[pre_&]:rounded-none [pre_&]:bg-transparent [pre_&]:px-0 [pre_&]:py-0 [pre_&]:text-emerald-50",
        className
      )}
    />
  ),
  pre: ({ node, ...props }) => (
    <pre {...props} className="fm-scroll my-4 overflow-x-auto rounded-xl bg-emerald-950 p-4 text-sm leading-relaxed text-emerald-50" />
  ),
  table: ({ node, ...props }) => (
    <div className="fm-scroll my-4 overflow-x-auto">
      <table {...props} className="w-full border-collapse text-sm" />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th {...props} className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-left font-semibold text-emerald-950" />
  ),
  td: ({ node, ...props }) => <td {...props} className="border border-emerald-200 px-3 py-2 text-emerald-950/90" />,
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline decoration-emerald-400/60 underline-offset-2 hover:text-emerald-800" />
  ),
  hr: ({ node, ...props }) => <hr {...props} className="my-8 border-t border-emerald-200" />,
  img: ({ node, alt, ...props }) => <img {...props} alt={alt ?? ""} className="my-4 max-w-full rounded-xl" loading="lazy" />,
  strong: ({ node, ...props }) => <strong {...props} className="font-bold text-emerald-950" />,
};

/* ══════════════════════════════════════════════════════════════════════ */

export function MarkdownEditor() {
  const { t, num, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [mode, setMode] = useState<"drop" | "edit">("drop");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("editor");
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasText = text.trim().length > 0;
  const baseName = fileName ? stripExt(fileName) : "document";
  const words = useMemo(() => text.split(/\s+/).filter(Boolean).length, [text]);

  /* ── file loading ──────────────────────────────────────────────────── */

  const readFile = useCallback(
    async (f: File) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["md", "markdown", "txt", "text", "mdown", "mkd"].includes(ext) && !f.type.startsWith("text/")) {
        toast.error(t("meLoadFail"));
        return;
      }
      try {
        const txt = await f.text();
        setFileName(f.name);
        setText(txt);
        setMode("edit");
      } catch {
        toast.error(t("meLoadFail"));
      }
    },
    [t]
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void readFile(f);
  };

  /* ── toolbar edits (setRangeText keeps the textarea's native undo) ─── */

  /** sync React state after a setRangeText call, then restore the caret */
  const commit = useCallback((selStart: number, selEnd: number) => {
    const ta = taRef.current;
    if (!ta) return;
    setText(ta.value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  }, []);

  /** wrap the selection (or insert pair) in a markdown marker */
  const surround = (mark: string, placeholder = "") => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    const inner = sel || placeholder;
    ta.setRangeText(mark + inner + mark, s, e, "end");
    commit(s + mark.length + inner.length + (sel ? mark.length : 0), s + mark.length + inner.length + (sel ? mark.length : 0));
  };

  /** prefix each selected line (H1/H2/quote/list) */
  const prefixLines = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const v = ta.value;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const ls = s === 0 ? 0 : v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e);
    if (le === -1) le = v.length;
    const next = v
      .slice(ls, le)
      .split("\n")
      .map((l) => prefix + l)
      .join("\n");
    ta.setRangeText(next, ls, le, "end");
    commit(ls + next.length, ls + next.length);
  };

  const insertLink = () => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    const inner = `[${sel || "title"}](https://)`;
    ta.setRangeText(inner, s, e, "end");
    if (sel) commit(s + inner.length, s + inner.length);
    else commit(s + 1, s + 6); // select the "title" placeholder
  };

  const insertTable = () => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const before = ta.value.slice(0, s);
    const lead = before && !before.endsWith("\n") ? "\n\n" : "";
    ta.setRangeText(lead + MD_TABLE, s, e, "end");
    commit(s + lead.length + MD_TABLE.length, s + lead.length + MD_TABLE.length);
  };

  const TOOLS: { id: string; icon: LucideIcon; label: string; run: () => void }[] = [
    { id: "bold", icon: Bold, label: t("meBold"), run: () => surround("**") },
    { id: "italic", icon: Italic, label: t("meItalic"), run: () => surround("*") },
    { id: "h1", icon: Heading1, label: t("meH1"), run: () => prefixLines("# ") },
    { id: "h2", icon: Heading2, label: t("meH2"), run: () => prefixLines("## ") },
    { id: "link", icon: Link2, label: t("meLink"), run: insertLink },
    { id: "code", icon: Code, label: t("meCode"), run: () => surround("`") },
    { id: "quote", icon: Quote, label: t("meQuote"), run: () => prefixLines("> ") },
    { id: "list", icon: List, label: t("meList"), run: () => prefixLines("- ") },
    { id: "table", icon: Table, label: t("meTable"), run: insertTable },
  ];

  /* ── exports ───────────────────────────────────────────────────────── */

  const runExport = (kind: BusyKind, fn: () => Promise<void>) => {
    if (busy !== null || !hasText) return;
    setBusy(kind);
    fn()
      .then(() => toast.success(t("meSaved")))
      .catch((err) => {
        console.error("[markdown-editor] export failed:", err);
        toast.error(t("meSaveFail"));
      })
      .finally(() => setBusy(null));
  };

  const exportMd = async () => {
    downloadBlob(new Blob([text], { type: "text/markdown;charset=utf-8" }), `${baseName}-edited.md`);
  };

  const exportHtml = async () => {
    const { marked } = await import("marked");
    const body = await marked.parse(text);
    const title = fileName ? stripExt(fileName) : t("meTitle");
    downloadBlob(
      new Blob([buildStandaloneHtml(body, title)], { type: "text/html;charset=utf-8" }),
      `${baseName}-edited.html`
    );
  };

  /** rasterize the live preview DOM → slice into A4 pages (Bengali-safe) */
  const exportPdf = async () => {
    const el = previewRef.current;
    if (!el) throw new Error("preview unavailable");

    /* the preview pane is display:none on mobile when the editor tab is
     * active — flip to it temporarily so html2canvas has real layout */
    let restorePane: Pane | null = null;
    if (el.offsetParent === null && pane !== "preview") {
      restorePane = pane;
      setPane("preview");
      await new Promise((r) => setTimeout(r, 120));
    }
    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true });

      const { jsPDF } = await import("jspdf");
      const pageW = 210;
      const pageH = 297;
      const pxPerMm = canvas.width / pageW;
      const sliceH = Math.ceil(pageH * pxPerMm); // canvas px covered by one A4 page
      const totalPages = Math.max(1, Math.ceil(canvas.height / sliceH));

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      for (let i = 0; i < totalPages; i++) {
        const sy = i * sliceH;
        const h = Math.min(sliceH, canvas.height - sy);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = h;
        const sctx = slice.getContext("2d");
        if (!sctx) throw new Error("2d context unavailable");
        sctx.fillStyle = "#ffffff";
        sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, sy, canvas.width, h, 0, 0, canvas.width, h);
        if (i > 0) pdf.addPage("a4", "p");
        pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, h / pxPerMm);
      }
      pdf.save(`${baseName}-edited.pdf`);
    } finally {
      if (restorePane) setPane(restorePane);
    }
  };

  /** hand-rolled markdown line parser → docx paragraphs (UTF-8, Bengali ok) */
  const exportDocx = async () => {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

    /** split a string into bold / italic / inline-code TextRuns */
    const inlineRuns = (s: string, extra: { italics?: boolean } = {}): DocxTextRun[] => {
      const toks = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
      if (!toks.length) return [new TextRun({ text: s, ...extra })];
      return toks.map((tok) => {
        if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4)
          return new TextRun({ text: tok.slice(2, -2), bold: true, ...extra });
        if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2)
          return new TextRun({ text: tok.slice(1, -1), italics: true, ...extra });
        if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2)
          return new TextRun({ text: tok.slice(1, -1), font: "Courier New", ...extra });
        return new TextRun({ text: tok, ...extra });
      });
    };

    const HEADING = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ];

    const paras: DocxParagraph[] = [];
    let inFence = false;
    for (const raw of text.split(/\r?\n/)) {
      if (/^\s*```/.test(raw)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        paras.push(new Paragraph({ children: [new TextRun({ text: raw, font: "Courier New", size: 20 })] }));
        continue;
      }
      if (!raw.trim()) continue; // blank line → skip

      const hm = /^(#{1,6})\s+(.*)$/.exec(raw);
      if (hm) {
        paras.push(new Paragraph({ text: hm[2].trim(), heading: HEADING[hm[1].length - 1] }));
        continue;
      }
      const bm = /^\s*[-*+]\s+(.*)$/.exec(raw);
      if (bm) {
        paras.push(new Paragraph({ children: inlineRuns(bm[1]), bullet: { level: 0 } }));
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(raw)) {
        paras.push(new Paragraph({ children: inlineRuns(raw.trim()) })); // keep the number text
        continue;
      }
      const qm = /^\s*>\s?(.*)$/.exec(raw);
      if (qm) {
        paras.push(new Paragraph({ children: inlineRuns(qm[1], { italics: true }), indent: { left: 720 } }));
        continue;
      }
      paras.push(new Paragraph({ children: inlineRuns(raw) }));
    }

    const doc = new Document({ sections: [{ children: paras }] });
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${baseName}-edited.docx`);
  };

  const EXPORTS: { kind: BusyKind; icon: LucideIcon; label: string; run: () => Promise<void> }[] = [
    { kind: "md", icon: FileText, label: t("meSaveMd"), run: exportMd },
    { kind: "html", icon: FileCode2, label: t("meSaveHtml"), run: exportHtml },
    { kind: "pdf", icon: FileType, label: t("meSavePdf"), run: exportPdf },
    { kind: "docx", icon: FileType2, label: t("meSaveDocx"), run: exportDocx },
  ];

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <section className="flex min-h-[calc(100vh-4rem)] flex-col" aria-label={t("meEditorAria")}>
      {/* ── header: back + title + exports ─────────────────────────────── */}
      <header className="sticky top-16 z-20 border-b border-emerald-900/[0.06] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={goHome}
            className="h-9 text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
            aria-label={lang === "en" ? "Back to home" : "হোমে ফিরে যান"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <h1 className="min-w-0 text-sm font-bold text-emerald-950 sm:text-base">{t("meTitle")}</h1>
          {fileName && (
            <span className="hidden min-w-0 max-w-[190px] truncate rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 md:block">
              {fileName}
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {EXPORTS.map(({ kind, icon: Icon, label, run }) => (
              <button
                key={kind}
                type="button"
                onClick={() => runExport(kind, run)}
                disabled={!hasText || busy !== null}
                title={label}
                aria-label={label}
                className="btn-shine inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-900/[0.07] bg-white px-2.5 text-xs font-semibold text-emerald-900/80 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-40"
              >
                {busy === kind ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{busy === kind ? t("meSaving") : label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readFile(f);
          e.target.value = "";
        }}
      />

      {/* ── welcome dropzone ───────────────────────────────────────────── */}
      {mode === "drop" ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10 sm:py-14">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              "fm-card fm-card-hover rounded-3xl border-2 border-dashed p-8 text-center transition sm:p-12",
              dragOver ? "border-emerald-500 bg-emerald-50/70" : "border-emerald-300/70"
            )}
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25">
              <UploadCloud className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-bold text-emerald-950 sm:text-xl">{t("meDrop")}</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-emerald-900/60">{t("meDropHint")}</p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="btn-shine h-10 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 text-sm font-semibold text-white shadow-md shadow-emerald-500/25 hover:brightness-105"
              >
                <UploadCloud className="h-4 w-4" />
                {t("mePick")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setFileName(null);
                  setText("");
                  setMode("edit");
                }}
                className="h-10 rounded-xl border-emerald-600/20 bg-white px-5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
              >
                <PenLine className="h-4 w-4" />
                {lang === "en" ? "Start typing" : "লিখতে শুরু করুন"}
              </Button>
            </div>

            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value.trim()) setMode("edit");
              }}
              placeholder={t("meDrop")}
              rows={3}
              aria-label={t("meEditorAria")}
              className="fm-scroll mt-6 w-full resize-none rounded-xl border border-emerald-900/10 bg-emerald-50/40 p-3.5 font-mono text-sm text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-300/40"
            />
          </div>
        </div>
      ) : (
        /* ── editor layout ────────────────────────────────────────────── */
        <div className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5 sm:py-5">
          {/* mobile pane toggle */}
          <Tabs
            value={pane}
            onValueChange={(v) => setPane(v as Pane)}
            className="mb-3 lg:hidden"
          >
            <TabsList className="grid w-full grid-cols-2 rounded-xl border border-emerald-900/[0.07] bg-white">
              <TabsTrigger
                value="editor"
                className="rounded-lg data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-900"
              >
                {t("meEditor")}
              </TabsTrigger>
              <TabsTrigger
                value="preview"
                className="rounded-lg data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-900"
              >
                {t("mePreview")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            {/* editor pane */}
            <div className={cn("fm-card rounded-2xl p-3 sm:p-4", pane !== "editor" && "hidden lg:block")}>
              <div role="toolbar" aria-label={t("meEditorAria")} className="mb-2.5 flex flex-wrap gap-1.5">
                {TOOLS.map(({ id, icon: Icon, label, run }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={run}
                    title={label}
                    aria-label={label}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-900/[0.07] bg-white px-2.5 text-xs font-semibold text-emerald-900/70 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>

              <Label htmlFor="fm-md-textarea" className="sr-only">
                {t("meEditorAria")}
              </Label>
              <textarea
                id="fm-md-textarea"
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("meDrop")}
                spellCheck={false}
                aria-label={t("meEditorAria")}
                className="fm-scroll min-h-[50vh] w-full resize-y rounded-xl border border-emerald-900/10 bg-emerald-50/30 p-4 font-mono text-sm leading-relaxed text-emerald-950 outline-none transition placeholder:text-emerald-900/35 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-300/40"
              />

              {/* live stats */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-live="polite">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  {num(words)} {t("meWords")}
                </span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  {num(text.length)} {t("meChars")}
                </span>
              </div>
            </div>

            {/* preview pane (always mounted so PDF raster works) */}
            <div className={cn("fm-card overflow-hidden rounded-2xl", pane !== "preview" && "hidden lg:block")}>
              <div className="flex items-center gap-1.5 border-b border-emerald-900/[0.06] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-emerald-900/50">
                <Eye className="h-3.5 w-3.5" />
                {t("mePreview")}
              </div>
              <div className="fm-scroll max-h-[75vh] overflow-y-auto">
                <div ref={previewRef} className="min-h-[50vh] px-5 py-5 sm:px-7 sm:py-6">
                  {hasText ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
                  ) : (
                    <p className="py-16 text-center text-sm italic text-emerald-900/35">{t("meDropHint")}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
