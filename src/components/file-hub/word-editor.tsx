"use client";

/* ═══════════════════════════════════════════════════════════════════════
   Word Editor (docx) — Day 6 of the 60-day business roadmap
   (docs/ROADMAP-60-DAYS.md, Phase 1)
   Pain point: "docx বানাতে MS Word লাগে"

   Rich-text editor (contentEditable, Bengali-safe Hind Siliguri):
     open blank / import .docx (mammoth → HTML) / .txt (paragraphs)
     toolbar: bold, italic, underline, H1, H2, bullet list, numbered list,
              align left/center/right, blockquote, clear formatting
     exports: .docx (DOM walk → docx Paragraph/TextRun, headings, bullets,
              ol numbered prefixes, alignment, bold/italic/underline)
              and .pdf (styled standalone HTML → html2canvas-pro → jsPDF).

   document.execCommand powers the toolbar — still the only cross-browser
   contentEditable command API; native undo/redo works inside the editor.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Download,
  Eraser,
  FileText,
  FileType2,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  ShieldCheck,
  Underline,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { downloadBlob, safeName, stripExt } from "@/lib/tools/helpers";
import { wrapHtmlDoc, htmlToPdfBlob } from "@/lib/tools/processors/docs";
import { useAppStore } from "@/store/app-store";

/* ── docx export: DOM walk → docx lib ──────────────────────────────────── */

type Inline = { text: string; bold?: boolean; italic?: boolean; underline?: boolean };

function collectInline(el: Node): Inline[] {
  const out: Inline[] = [];
  const walk = (n: Node, fmt: Omit<Inline, "text">) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent ?? "";
      if (text) out.push({ text, ...fmt });
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    const tag = e.tagName.toLowerCase();
    const next: Omit<Inline, "text"> = {
      bold: fmt.bold || tag === "b" || tag === "strong",
      italic: fmt.italic || tag === "i" || tag === "em",
      underline: fmt.underline || tag === "u",
    };
    e.childNodes.forEach((c) => walk(c, next));
  };
  walk(el, {});
  return out;
}

function alignOf(el: Element): "left" | "center" | "right" | undefined {
  const style = (el as HTMLElement).style;
  const a = (el.getAttribute("align") || style?.textAlign || "").toLowerCase();
  if (a === "center" || a === "right") return a;
  return undefined;
}

async function htmlToDocxBlob(html: string, title: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } =
    await import("docx");
  const dom = new DOMParser().parseFromString(html, "text/html");
  const blocks: InstanceType<typeof Paragraph>[] = [];

  const olCounters = new Map<Element, number>();

  const pushRuns = (el: Element, opts: Record<string, unknown>) => {
    const inlines = collectInline(el).filter((i) => i.text.trim().length > 0 || i.text === " ");
    if (inlines.length === 0) {
      blocks.push(new Paragraph({ ...opts, children: [] }));
      return;
    }
    const runs = inlines.map(
      (i) =>
        new TextRun({
          text: i.text,
          bold: i.bold || undefined,
          italics: i.italic || undefined,
          underline: i.underline ? {} : undefined,
          font: "Hind Siliguri",
        })
    );
    blocks.push(new Paragraph({ ...opts, children: runs }));
  };

  const walkBlocks = (root: Element) => {
    for (const el of Array.from(root.children)) {
      const tag = el.tagName.toLowerCase();
      const align = alignOf(el);
      const alignment = align === "center" ? AlignmentType.CENTER : align === "right" ? AlignmentType.RIGHT : undefined;
      if (/^h[1-6]$/.test(tag)) {
        const level =
          tag === "h1" ? HeadingLevel.HEADING_1 : tag === "h2" ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        pushRuns(el, { heading: level, alignment });
      } else if (tag === "blockquote") {
        pushRuns(el, { ...({ bullet: { level: 0 } } as object), alignment });
      } else if (tag === "ul" || tag === "ol") {
        el.querySelectorAll(":scope > li").forEach((li) => {
          if (tag === "ul") {
            pushRuns(li, { bullet: { level: 0 }, alignment });
          } else {
            const n = (olCounters.get(el) ?? 0) + 1;
            olCounters.set(el, n);
            const inlines = collectInline(li);
            const runs = inlines.map(
              (i) =>
                new TextRun({
                  text: i.text,
                  bold: i.bold || undefined,
                  italics: i.italic || undefined,
                  underline: i.underline ? {} : undefined,
                  font: "Hind Siliguri",
                })
            );
            blocks.push(
              new Paragraph({
                alignment,
                children: [new TextRun({ text: `${n}. `, font: "Hind Siliguri" }), ...runs],
              })
            );
          }
        });
        // nested lists inside li were already flattened by :scope > li handling
      } else if (tag === "hr") {
        blocks.push(new Paragraph({ text: "", border: { bottom: { style: "single", size: 6, color: "999999" } } }));
      } else if (tag === "table") {
        el.querySelectorAll("tr").forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll("th,td"));
          const runs = cells.flatMap((td, idx) => {
            const text = (td.textContent ?? "").trim();
            const run = new TextRun({ text: text ? text + (idx < cells.length - 1 ? "\t" : "") : "", font: "Hind Siliguri" });
            return [run];
          });
          blocks.push(new Paragraph({ children: runs }));
        });
      } else if (tag === "br") {
        blocks.push(new Paragraph({ text: "" }));
      } else if (tag === "div" || tag === "section" || tag === "article") {
        if (el.querySelector("p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table")) walkBlocks(el);
        else pushRuns(el, { alignment });
      } else {
        // p, pre, and anything else textual
        pushRuns(el, tag === "pre" ? { alignment } : { alignment });
      }
    }
  };

  walkBlocks(dom.body);
  if (blocks.length === 0) blocks.push(new Paragraph({ text: "" }));

  const doc = new Document({
    creator: "File Magic",
    title,
    sections: [{ properties: {}, children: blocks }],
  });
  return Packer.toBlob(doc);
}

/* ── component ─────────────────────────────────────────────────────────── */

export function WordEditor() {
  const { t, num } = useT();
  const goHome = useAppStore((s) => s.goHome);

  const [docName, setDocName] = useState<string>("document");
  const [busy, setBusy] = useState<"" | "import" | "docx" | "pdf">("");
  const [pct, setPct] = useState(0);
  const [words, setWords] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const edRef = useRef<HTMLDivElement>(null);

  const recount = useCallback(() => {
    const text = edRef.current?.innerText ?? "";
    setWords(text.split(/\s+/).filter(Boolean).length);
  }, []);

  useEffect(() => {
    recount();
  }, [recount]);

  const exec = (cmd: string, value?: string) => {
    edRef.current?.focus();
    document.execCommand(cmd, false, value);
    recount();
  };

  /* ── import ── */
  const importFile = async (file: File) => {
    const ext = (file.name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
    setBusy("import");
    try {
      if (ext === "docx") {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        if (edRef.current) edRef.current.innerHTML = value || "";
      } else if (ext === "txt" || ext === "md") {
        const text = await file.text();
        const html = text
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`)
          .join("");
        if (edRef.current) edRef.current.innerHTML = html;
      } else {
        toast.error(t("weBadType"));
        return;
      }
      setDocName(stripExt(file.name));
      recount();
      toast.success(t("weImported"));
    } catch {
      toast.error(t("weImportFail"));
    } finally {
      setBusy("");
    }
  };

  /* ── exports ── */
  const exportDocx = async () => {
    const html = edRef.current?.innerHTML ?? "";
    if (!html.replace(/<[^>]*>/g, "").trim()) return toast.error(t("weEmpty"));
    setBusy("docx");
    try {
      const blob = await htmlToDocxBlob(html, docName);
      downloadBlob(blob, safeName(`${docName}.docx`));
      toast.success(t("weDocxDone"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("genericErr"));
    } finally {
      setBusy("");
    }
  };

  const exportPdf = async () => {
    const html = edRef.current?.innerHTML ?? "";
    if (!html.replace(/<[^>]*>/g, "").trim()) return toast.error(t("weEmpty"));
    setBusy("pdf");
    setPct(5);
    try {
      const styled = wrapHtmlDoc(html, docName);
      const blob = await htmlToPdfBlob(styled, (p) => setPct(Math.max(pct, p)));
      downloadBlob(blob, safeName(`${docName}.pdf`));
      toast.success(t("wePdfDone"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("genericErr"));
    } finally {
      setBusy("");
    }
  };

  const toolBtn = (
    icon: React.ReactNode,
    label: string,
    cmd: string,
    value?: string
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()} // keep text selection
      onClick={() => exec(cmd, value)}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700 dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
    >
      {icon}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-3 pb-10 pt-4 sm:px-6">
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
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/30">
          <FileType2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold sm:text-xl">{t("weTitle")}</h1>
          <p className="truncate text-xs text-muted-foreground">{t("weTagline")}</p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          {t("bsPrivacy")}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        className="sr-only"
        aria-label={t("weImportAria")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />

      {/* toolbar */}
      <div className="fm-card sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-0.5 rounded-2xl p-2">
        {toolBtn(<Bold className="h-4 w-4" />, t("weBold"), "bold")}
        {toolBtn(<Italic className="h-4 w-4" />, t("weItalic"), "italic")}
        {toolBtn(<Underline className="h-4 w-4" />, t("weUnderline"), "underline")}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        {toolBtn(<Heading1 className="h-4 w-4" />, t("weH1"), "formatBlock", "<h1>")}
        {toolBtn(<Heading2 className="h-4 w-4" />, t("weH2"), "formatBlock", "<h2>")}
        {toolBtn(<FileText className="h-4 w-4" />, t("wePara"), "formatBlock", "<p>")}
        {toolBtn(<Quote className="h-4 w-4" />, t("weQuote"), "formatBlock", "<blockquote>")}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        {toolBtn(<List className="h-4 w-4" />, t("weUl"), "insertUnorderedList")}
        {toolBtn(<ListOrdered className="h-4 w-4" />, t("weOl"), "insertOrderedList")}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        {toolBtn(<AlignLeft className="h-4 w-4" />, t("weAlignL"), "justifyLeft")}
        {toolBtn(<AlignCenter className="h-4 w-4" />, t("weAlignC"), "justifyCenter")}
        {toolBtn(<AlignRight className="h-4 w-4" />, t("weAlignR"), "justifyRight")}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        {toolBtn(<Eraser className="h-4 w-4" />, t("weClearFmt"), "removeFormat")}
        <span className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="h-10 rounded-xl px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
          >
            {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("weImport")}
          </button>
        </span>
      </div>

      {/* paper */}
      <div className="fm-card overflow-hidden rounded-2xl">
        <div
          ref={edRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={t("weEditorAria")}
          spellCheck={false}
          onInput={recount}
          onPaste={(e) => {
            // keep pasted text sane: strip scripts/styles silently
            const text = e.clipboardData.getData("text/html");
            if (text && /<script|<style/i.test(text)) {
              e.preventDefault();
              document.execCommand("insertHTML", false, text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, ""));
            }
          }}
          className="we-paper min-h-[420px] w-full bg-white px-6 py-8 text-[15px] leading-7 text-slate-900 outline-none sm:px-10 sm:py-12 dark:bg-[#101017] dark:text-slate-100 [&_blockquote]:border-l-4 [&_blockquote]:border-emerald-400 [&_blockquote]:ps-4 [&_blockquote]:italic [&_blockquote]:text-slate-600 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ms-6 [&_ol]:list-decimal [&_p]:my-2 [&_ul]:list-disc [&_ul_li]:my-0.5"
          data-placeholder={t("wePlaceholder")}
        />
      </div>

      {/* footer actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="me-auto rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          {num(words)} {t("weWords")}
        </span>
        <Button
          variant="outline"
          onClick={exportPdf}
          disabled={busy !== ""}
          className="h-11 gap-2 rounded-xl border-border/70 bg-white font-semibold dark:bg-white/5"
        >
          {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {t("weExportPdf")}
        </Button>
        <Button
          onClick={exportDocx}
          disabled={busy !== ""}
          className="h-11 gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-lg shadow-emerald-500/30 hover:from-emerald-600 hover:to-teal-700"
        >
          {busy === "docx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t("weExportDocx")}
        </Button>
      </div>
      {(busy === "pdf" || busy === "docx") && (
        <div className="mt-3">
          <Progress value={busy === "pdf" ? pct : undefined} aria-label={t("progressAria")} />
        </div>
      )}
      <p className="mt-3 text-center text-xs text-muted-foreground">{t("weHint")}</p>
    </div>
  );
}
