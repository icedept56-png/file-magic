"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Download,
  Eraser,
  EyeOff,
  GripHorizontal,
  Highlighter,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  PenTool,
  RotateCw,
  Shapes,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  Undo2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { removeTextInRects, type UserRect } from "@/lib/pdf/text-surgery";
import { downloadBlob, formatBytes } from "@/lib/tools/helpers";
import { useAppStore } from "@/store/app-store";
import { SignaturePad } from "./signature-pad";

/* ── pdfjs types (type-query only, no runtime import) ──────────────────── */
type PdfJsDoc = Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>;
type PdfJsPage = Awaited<ReturnType<PdfJsDoc["getPage"]>>;

/* ── editor element model (coords = display-space PDF points, y-down) ──── */
type Pt = { x: number; y: number };

type EditorEl =
  | { id: string; type: "whiteout"; x: number; y: number; w: number; h: number }
  | { id: string; type: "highlight"; x: number; y: number; w: number; h: number; color: string }
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      w: number;
      text: string;
      size: number;
      color: string;
      bold: boolean;
      /** present when this box was created from the PDF's own text */
      nativeId?: number;
      /** original text bbox (display pt) — drives true stream removal on export */
      nativeBox?: { x: number; y: number; w: number; h: number };
      /** per-item rects of the original line — precise stream removal */
      nativeParts?: { x: number; y: number; w: number; h: number }[];
      /** sampled page colour behind the original line (editing underlay) */
      bg?: string;
    }
  | { id: string; type: "image"; x: number; y: number; w: number; h: number; dataUrl: string }
  | { id: string; type: "draw"; color: string; width: number; points: Pt[] }
  | { id: string; type: "redact"; x: number; y: number; w: number; h: number }
  | {
      id: string;
      type: "shape";
      shape: "rect" | "ellipse" | "line" | "arrow";
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      color: string;
      width: number;
    };

type Snapshot = {
  elements: Record<number, EditorEl[]>;
  deleted: number[];
  rotation: Record<number, number>;
  removedNative: Record<number, number[]>;
  pageOrder: number[];
};

type ToolId = "select" | "editText" | "whiteout" | "redact" | "highlight" | "text" | "shape" | "draw";

type NativeBox = {
  /** first content item index — stable across rotations, unique per line */
  idx: number;
  /** every member item index (words, spaces, kerned runs) */
  idxs: number[];
  x: number;
  y: number;
  w: number;
  h: number;
  str: string;
  size: number;
  baselineY: number;
  /** tight per-item rects — one content-stream operator each */
  parts: { x: number; y: number; w: number; h: number }[];
};

const MAX_PAGES = 300;
/** files above this size skip the pdf-lib preview rebuild (pixel covers instead) */
const PREVIEW_SIZE_LIMIT = 12_000_000;
const uid = () => Math.random().toString(36).slice(2, 10);

/* ── rotation-aware coordinate mapping (display → unrotated pdf space) ─── */
function mapRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
  Wd: number,
  Hd: number
): { x: number; y: number; w: number; h: number } {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return { x: y, y: Wd - x - w, w: h, h: w };
    case 180:
      return { x: Wd - x - w, y: Hd - y - h, w, h };
    case 270:
      return { x: Hd - y - h, y: x, w: h, h: w };
    default:
      return { x, y, w, h };
  }
}

/** rotate page elements 90° CW with the page (old display W×H → H×W) */
function rotateElsCW(els: EditorEl[], Hd: number): EditorEl[] {
  return els.map((el) => {
    if (el.type === "draw") {
      return { ...el, points: el.points.map((p) => ({ x: Hd - p.y, y: p.x })) };
    }
    if (el.type === "text") {
      // rotate the anchor box; the text re-renders horizontal in the new orientation
      const rot = (p: { x: number; y: number; w: number; h: number }) => ({
        x: Hd - p.y - p.h,
        y: p.x,
        w: p.h,
        h: p.w,
      });
      return {
        ...el,
        x: Hd - el.y - el.size,
        y: el.x,
        nativeBox: el.nativeBox ? rot(el.nativeBox) : undefined,
        nativeParts: el.nativeParts?.length ? el.nativeParts.map(rot) : undefined,
      };
    }
    if (el.type === "shape") {
      const p0 = { x: Hd - el.y0, y: el.x0 };
      const p1 = { x: Hd - el.y1, y: el.x1 };
      return { ...el, x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
    }
    return { ...el, x: Hd - el.y - el.h, y: el.x, w: el.h, h: el.w };
  });
}

/** map a single display point to unrotated display space (y still down) */
function mapPt(x: number, y: number, rot: number, Wd: number, Hd: number): Pt {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return { x: y, y: Wd - x };
    case 180:
      return { x: Wd - x, y: Hd - y };
    case 270:
      return { x: Hd - y, y: x };
    default:
      return { x, y };
  }
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x000000;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/* ══════════════════════════════════════════════════════════════════════ */

export function PdfEditor() {
  const { t, lang, num } = useT();
  const goHome = useAppStore((s) => s.goHome);

  /* document state */
  const bytesRef = useRef<Uint8Array | null>(null);
  const fileNameRef = useRef("document.pdf");
  const [pdfDoc, setPdfDoc] = useState<PdfJsDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [pageNum, setPageNum] = useState(0); // original page index
  const [zoom, setZoom] = useState(1);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [savedBytes, setSavedBytes] = useState<number | null>(null);

  /* render geometry */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  /* live WYSIWYG preview — a pdfjs doc whose edited text ops are already gone */
  const previewDocRef = useRef<PdfJsDoc | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [coverTick, setCoverTick] = useState(0);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewJobRef = useRef<Promise<void>>(Promise.resolve());
  const previewPendingRef = useRef(false);
  const [disp, setDisp] = useState({ w: 595, h: 842 }); // display-space pt of current page
  const [fitScale, setFitScale] = useState(1); // css px per pt

  /* edits */
  const [elements, setElements] = useState<Record<number, EditorEl[]>>({});
  const [deleted, setDeleted] = useState<number[]>([]);
  const [rotation, setRotation] = useState<Record<number, number>>({});
  const [removedNative, setRemovedNative] = useState<Record<number, number[]>>({});
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const undoStack = useRef<Snapshot[]>([]);

  /* pdf's own text LINES (clustered, display-space) for direct editing */
  const [nativeBoxes, setNativeBoxes] = useState<Record<string, NativeBox[]>>({});
  const [scanningText, setScanningText] = useState(false);

  /* ui */
  const [tool, setTool] = useState<ToolId>("select");
  const [color, setColor] = useState("#f59e0b");
  const [textSize, setTextSize] = useState(16);
  const [strokeW, setStrokeW] = useState(3);
  const [shapeKind, setShapeKind] = useState<"rect" | "ellipse" | "line" | "arrow">("rect");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);

  /* interaction drafts (state for visual, refs for math) */
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draftPath, setDraftPath] = useState<Pt[] | null>(null);
  const dragRef = useRef<
    | { mode: "move"; id: string; offX: number; offY: number; lx: number; ly: number }
    | { mode: "resize"; id: string; x0: number; y0: number; w0: number; h0: number; ratio: number }
    | { mode: "rect"; x0: number; y0: number }
    | { mode: "draw" }
    | null
  >(null);

  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const textRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusNewText = useRef<string | null>(null);
  /* mirrors for imperative DOM sync (always read the freshest edits) */
  const elsRef = useRef<Record<number, EditorEl[]>>({});
  elsRef.current = elements;
  const pageNumRef = useRef(pageNum);
  pageNumRef.current = pageNum;
  const removedNativeRef = useRef(removedNative);
  removedNativeRef.current = removedNative;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const nativeBoxesRef = useRef(nativeBoxes);
  nativeBoxesRef.current = nativeBoxes;
  const pageSizeRef = useRef<Record<number, { w: number; h: number }>>({});
  const autoEditRef = useRef(true);

  const hasEdits =
    Object.values(elements).some((a) => a.length > 0) || deleted.length > 0 ||
    Object.values(removedNative).some((a) => a.length > 0) ||
    (pageOrder.length > 0 && pageOrder.some((v, i) => v !== i)) ||
    Object.values(rotation).some((r) => r !== 0);

  const pageEls = elements[pageNum] ?? [];
  const totalRot = ((rotation[pageNum] ?? 0) + 360) % 360;

  /* ── WYSIWYG preview: pages re-rendered with removed text truly gone ── */

  /** collect user-space rects whose text-show operators must disappear */
  const computeNativeRects = useCallback(
    (
      pageIdx: number,
      rot: number,
      Wu: number,
      Hu: number,
      includeRedact: boolean
    ): UserRect[] => {
      const rects: UserRect[] = [];
      const sizes = pageSizeRef.current[pageIdx];
      if (!sizes) return rects;
      const dims = (r: number) =>
        (((r % 360) + 360) % 360) % 180 === 90
          ? { w: sizes.h, h: sizes.w }
          : { w: sizes.w, h: sizes.h };
      const push = (x: number, y: number, w: number, h: number, r: number) => {
        const d = dims(r);
        const m = mapRect(x, y, w, h, r, d.w, d.h);
        rects.push({
          x0: m.x - 0.6,
          y0: Hu - m.y - m.h - 0.6,
          x1: m.x + m.w + 0.6,
          y1: Hu - m.y + 0.6,
        });
      };

      for (const el of elsRef.current[pageIdx] ?? []) {
        if (el.type === "text" && el.nativeBox) {
          for (const p of el.nativeParts?.length ? el.nativeParts : [el.nativeBox]) {
            push(p.x, p.y, p.w, p.h, rot);
          }
        } else if (el.type === "redact" && includeRedact) {
          const d = dims(rot);
          const m = mapRect(el.x - 0.5, el.y - 0.5, el.w + 1, el.h + 1, rot, d.w, d.h);
          rects.push({
            x0: m.x - 0.5,
            y0: Hu - m.y - m.h - 0.5,
            x1: m.x + m.w + 0.5,
            y1: Hu - m.y + 0.5,
            heuristic: true,
          });
        }
      }

      const gone = removedNativeRef.current[pageIdx] ?? [];
      if (gone.length) {
        let scan = nativeBoxesRef.current[`${pageIdx}:${rot}`];
        let scanRot: number | null = scan ? rot : null;
        if (!scan) {
          for (const [k, v] of Object.entries(nativeBoxesRef.current)) {
            if (v.length && k.startsWith(`${pageIdx}:`)) {
              scan = v;
              scanRot = Number(k.split(":")[1]);
              break;
            }
          }
        }
        if (scan) {
          for (const idx of gone) {
            const nb = scan.find((b) => b.idx === idx);
            if (!nb) continue;
            for (const p of nb.parts) push(p.x, p.y, p.w, p.h, scanRot ?? rot);
          }
        }
      }
      return rects;
    },
    []
  );

  /** rebuild the on-screen document with ALL edited pages surgerized */
  const runPreview = useCallback(async () => {
    const bytes = bytesRef.current;
    if (!bytes) return;
    const dirty = new Set<number>();
    for (const [k, v] of Object.entries(removedNativeRef.current)) {
      if (v.length) dirty.add(Number(k));
    }
    for (const [k, arr] of Object.entries(elsRef.current)) {
      if (arr.some((e) => e.type === "text" && e.nativeBox)) dirty.add(Number(k));
    }
    if (dirty.size === 0) {
      if (previewDocRef.current) {
        previewDocRef.current.destroy().catch(() => {});
        previewDocRef.current = null;
        setPreviewTick((t) => t + 1);
      }
      return;
    }
    if (bytes.length > PREVIEW_SIZE_LIMIT) {
      setCoverTick((t) => t + 1); // too big to re-surgery — paint covers instead
      return;
    }
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
      for (const p of dirty) {
        const page = pdf.getPages()[p];
        if (!page) continue;
        const { width: Wu, height: Hu } = page.getSize();
        const rot = ((rotationRef.current[p] ?? 0) + 360) % 360;
        const rects = computeNativeRects(p, rot, Wu, Hu, false);
        if (rects.length) await removeTextInRects(pdf, p, rects);
      }
      const out = await pdf.save();
      const pdfjs = await import("pdfjs-dist");
      const doc = await pdfjs.getDocument({ data: out.slice() }).promise;
      previewDocRef.current?.destroy().catch(() => {});
      previewDocRef.current = doc;
      setPreviewTick((t) => t + 1);
    } catch {
      setCoverTick((t) => t + 1); // never block editing on preview failures
    }
  }, [computeNativeRects]);

  /** coalesce rapid commits into one preview rebuild */
  const schedulePreview = useCallback(() => {
    if (!bytesRef.current) return;
    previewPendingRef.current = true;
    setPreviewBusy(true);
    previewJobRef.current = previewJobRef.current
      .then(async () => {
        if (!previewPendingRef.current) return;
        previewPendingRef.current = false;
        await new Promise((r) => setTimeout(r, 90));
        await runPreview();
      })
      .catch(() => {})
      .finally(() => {
        if (!previewPendingRef.current) setPreviewBusy(false);
      });
  }, [runPreview]);

  /* ── undo ─────────────────────────────────────────────────────────── */
  const pushUndo = useCallback(() => {
    undoStack.current = [
      ...undoStack.current.slice(-39),
      {
        elements: structuredClone(elements),
        deleted: [...deleted],
        rotation: { ...rotation },
        removedNative: structuredClone(removedNative),
        pageOrder: [...pageOrder],
      },
    ];
  }, [elements, deleted, rotation, removedNative, pageOrder]);

  const undo = useCallback(() => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    setElements(snap.elements);
    setDeleted(snap.deleted);
    setRotation(snap.rotation);
    setRemovedNative(snap.removedNative);
    setPageOrder(snap.pageOrder);
    setSelectedId(null);
    schedulePreview(); // re-sync the WYSIWYG preview with the restored state
  }, [schedulePreview]);

  /* ── load document ────────────────────────────────────────────────── */
  const openBytes = useCallback(
    async (buf: ArrayBuffer, name: string) => {
      setLoading(true);
      setSavedBytes(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const raw = new Uint8Array(buf);
        bytesRef.current = raw.slice(); // keep a pristine copy for pdf-lib
        fileNameRef.current = name;
        const doc = await pdfjs.getDocument({ data: raw.slice() }).promise;
        if (doc.numPages > MAX_PAGES) {
          await doc.destroy();
          throw new Error("too-many-pages");
        }
        setPdfDoc((old) => {
          old?.destroy().catch(() => {});
          return doc;
        });
        setPageCount(doc.numPages);
        setPageNum(0);
        setElements({});
        setDeleted([]);
        setRotation({});
        setRemovedNative({});
        setPageOrder(Array.from({ length: doc.numPages }, (_, k) => k));
        setNativeBoxes({});
        autoEditRef.current = true;
        previewDocRef.current?.destroy().catch(() => {});
        previewDocRef.current = null;
        previewPendingRef.current = false;
        setPreviewBusy(false);
        setPreviewTick(0);
        setCoverTick(0);
        setThumbs([]);
        setZoom(1);
        setSelectedId(null);
        undoStack.current = [];

        // thumbnails (sequential, cheap scale) + unrotated page-size cache
        const tNails: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp1 = page.getViewport({ scale: 1, rotation: 0 });
          pageSizeRef.current[i - 1] = { w: vp1.width, h: vp1.height };
          const vp = page.getViewport({ scale: 96 / vp1.width, rotation: 0 });
          const c = document.createElement("canvas");
          c.width = Math.ceil(vp.width);
          c.height = Math.ceil(vp.height);
          await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
          tNails.push(c.toDataURL("image/jpeg", 0.75));
          if (i === 40) break; // enough for the rail; pages beyond stay numbered
        }
        // unrotated sizes for pages whose thumbnail was skipped
        for (let i = 41; i <= doc.numPages; i++) {
          if (pageSizeRef.current[i - 1]) continue;
          const pg = await doc.getPage(i);
          const v1 = pg.getViewport({ scale: 1, rotation: 0 });
          pageSizeRef.current[i - 1] = { w: v1.width, h: v1.height };
        }
        setThumbs(tNails);
      } catch {
        toast.error(t("edLoadFail"));
        setPdfDoc(null);
        setPageCount(0);
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  const openFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        toast.error(t("edLoadFail"));
        return;
      }
      file.arrayBuffer().then((buf) => openBytes(buf, file.name));
    },
    [openBytes, t]
  );

  /* ── render current page ──────────────────────────────────────────── */
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    (async () => {
      const srcDoc = previewDocRef.current ?? pdfDoc;
      const page: PdfJsPage = await srcDoc.getPage(pageNum + 1);
      const vp1 = page.getViewport({ scale: 1, rotation: totalRot });
      const stage = stageRef.current;
      const avail = stage ? stage.clientWidth - 32 : 700;
      const fit = Math.max(0.2, Math.min(avail / vp1.width, 2.5));
      const scale = fit * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr, rotation: totalRot });

      if (cancelled) return;
      setDisp({ w: vp1.width, h: vp1.height });
      setFitScale(scale);

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext("2d")!;
      renderTaskRef.current?.cancel();
      const task = page.render({ canvasContext: ctx, viewport: vp });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        return; /* cancelled render — ignore */
      }
      if (cancelled) return;

      /* big-file fallback: no surgery re-render — paint bg-coloured
         covers over removed lines so the WYSIWYG illusion still holds */
      const bytes = bytesRef.current;
      if (previewDocRef.current === null && bytes && bytes.length > PREVIEW_SIZE_LIMIT) {
        const S = scale * dpr;
        const cover = (x: number, y: number, w: number, h: number) => {
          let fill = "#ffffff";
          try {
            const sx = Math.round((x - 4) * S);
            const sy = Math.round((y + h / 2) * S);
            if (sx >= 0 && sy >= 0 && sx < canvas.width && sy < canvas.height) {
              const d = ctx.getImageData(sx, sy, 1, 1).data;
              if (d[3] > 10) fill = `rgb(${d[0]},${d[1]},${d[2]})`;
            }
          } catch {
            /* keep white */
          }
          ctx.fillStyle = fill;
          ctx.fillRect(x * S - 1, y * S - 1, w * S + 2, h * S + 2);
        };
        for (const el of elsRef.current[pageNum] ?? []) {
          if (el.type === "text" && el.nativeBox) {
            for (const p of el.nativeParts?.length ? el.nativeParts : [el.nativeBox]) {
              cover(p.x, p.y, p.w, p.h);
            }
          }
        }
        const scan = nativeBoxesRef.current[`${pageNum}:${totalRot}`];
        for (const idx of removedNativeRef.current[pageNum] ?? []) {
          const nb = scan?.find((b) => b.idx === idx);
          if (nb) for (const p of nb.parts) cover(p.x, p.y, p.w, p.h);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNum, zoom, totalRot, previewTick, coverTick]);

  /* focus newly created text */
  useEffect(() => {
    if (focusNewText.current) {
      const el = textRefs.current[focusNewText.current];
      if (el) {
        // fill the initial content BEFORE focusing — native boxes carry the
        // PDF's own text, and the deferred ref-sync skips focused nodes
        const cur = (elsRef.current[pageNumRef.current] ?? []).find(
          (x) => x.id === focusNewText.current
        );
        const latest = cur && cur.type === "text" ? cur.text : "";
        if (el.innerText !== latest) el.innerText = latest;
        el.focus();
        const sel = window.getSelection();
        if (sel) sel.selectAllChildren(el);
      }
      focusNewText.current = null;
    }
  }, [selectedId, elements]);

  /* ── detect the PDF's own text (clustered into editable LINES) ────── */
  useEffect(() => {
    if (!pdfDoc) return;
    const key = `${pageNum}:${totalRot}`;
    if (nativeBoxes[key]) return; // cached for this page + rotation
    let cancelled = false;
    setScanningText(true);
    (async () => {
      try {
        const page: PdfJsPage = await pdfDoc.getPage(pageNum + 1);
        const vp1 = page.getViewport({ scale: 1, rotation: totalRot });
        const content = await page.getTextContent();
        if (cancelled) return;
        const vt = vp1.transform;

        type Frag = {
          idx: number;
          x0: number;
          x1: number;
          by: number;
          fontH: number;
          str: string;
          horiz: boolean;
        };
        const frags: Frag[] = [];
        content.items.forEach((it, idx) => {
          if (!("str" in it) || !it.str) return; // keep whitespace runs — they are real operators
          const item = it as { str: string; width: number; height: number; transform: number[] };
          // viewport.transform × item.transform → display space (pt, y-down)
          const tr = item.transform;
          const tx = [
            vt[0] * tr[0] + vt[2] * tr[1],
            vt[1] * tr[0] + vt[3] * tr[1],
            vt[0] * tr[2] + vt[2] * tr[3],
            vt[1] * tr[2] + vt[3] * tr[3],
            vt[0] * tr[4] + vt[2] * tr[5] + vt[4],
            vt[1] * tr[4] + vt[3] * tr[5] + vt[5],
          ];
          const fontH = Math.hypot(tx[2], tx[3]) || item.height || 10;
          const dir = Math.hypot(tx[0], tx[1]) || 1;
          const w = Math.abs(item.width) || item.str.length * fontH * 0.5;
          const bx0 = tx[4];
          const by0 = tx[5];
          const bx1 = bx0 + (tx[0] / dir) * w;
          frags.push({
            idx,
            x0: Math.min(bx0, bx1),
            x1: Math.max(bx0, bx1),
            by: by0,
            fontH,
            str: item.str,
            horiz: Math.abs(tx[0]) >= Math.abs(tx[1]),
          });
        });

        /* group fragments whose baselines coincide → whole visual lines.
           Real-world PDFs (Word, LaTeX…) emit one fragment PER WORD —
           editing must operate on the full line, not tiny shards. */
        const groups: Frag[][] = [];
        for (const f of frags) {
          if (!f.horiz) {
            groups.push([f]);
            continue;
          }
          const tol = Math.max(1.5, 0.42 * f.fontH);
          const g = groups.find(
            (G) =>
              G[0].horiz &&
              Math.abs(G.reduce((s, m) => s + m.by, 0) / G.length - f.by) <= tol
          );
          if (g) g.push(f);
          else groups.push([f]);
        }

        const boxes: NativeBox[] = [];
        for (const G of groups) {
          const ms = G.slice().sort((a, b) => a.x0 - b.x0);
          const fontH = Math.max(...ms.map((m) => m.fontH));
          /* split at wide gaps so table columns / page numbers stay separate */
          let seg: Frag[] = [];
          const flush = () => {
            if (!seg.length) return;
            let str = "";
            let cursor: number | null = null;
            for (const m of seg) {
              const gap = cursor == null ? 0 : m.x0 - cursor;
              if (cursor != null && gap > 0.22 * fontH && !/\s$/.test(str) && !/^\s/.test(m.str)) {
                str += " ";
              }
              str += m.str;
              cursor = m.x1;
            }
            if (!str.trim()) {
              seg = [];
              return;
            }
            const x0 = Math.min(...seg.map((m) => m.x0));
            const x1 = Math.max(...seg.map((m) => m.x1));
            const by = seg[0].by;
            boxes.push({
              idx: seg[0].idx,
              idxs: seg.map((m) => m.idx),
              x: x0 - 0.5,
              y: by - 0.88 * fontH - 0.5,
              w: x1 - x0 + 1,
              h: 1.16 * fontH + 1,
              str,
              size: fontH,
              baselineY: by,
              parts: seg.map((m) => ({
                x: m.x0 - 0.5,
                y: m.by - 0.88 * m.fontH,
                w: m.x1 - m.x0 + 1,
                h: 1.16 * m.fontH,
              })),
            });
            seg = [];
          };
          for (const m of ms) {
            if (seg.length && m.x0 - seg[seg.length - 1].x1 > 3.5 * fontH) flush();
            seg.push(m);
          }
          flush();
        }
        boxes.sort((a, b) => a.y - b.y || a.x - b.x);
        setNativeBoxes((m) => ({ ...m, [key]: boxes }));

        /* first open of a text-bearing PDF → jump straight into text editing */
        if (boxes.length > 0 && autoEditRef.current) {
          autoEditRef.current = false;
          setTool((t) => (t === "select" ? "editText" : t));
        }
      } catch {
        if (!cancelled) setNativeBoxes((m) => ({ ...m, [key]: [] }));
      } finally {
        if (!cancelled) setScanningText(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // boxes live in the rotated frame — re-scan when rotation changes
  }, [pdfDoc, pageNum, totalRot, nativeBoxes]);

  /* keyboard: delete / escape */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      const editing =
        a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        setSelectedId(null);
        (a as HTMLDivElement | null)?.blur?.();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !editing) {
        e.preventDefault();
        pushUndo();
        deleteElement(pageNum, selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, pageNum, pushUndo]);

  /* leave guard */
  useEffect(() => {
    if (!hasEdits) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [hasEdits]);

  /* ── element helpers ─────────────────────────────────────────────── */
  const updateEls = useCallback(
    (fn: (els: EditorEl[]) => EditorEl[]) => {
      setElements((m) => ({ ...m, [pageNum]: fn(m[pageNum] ?? []) }));
    },
    [pageNum]
  );

  const toPt = (e: React.PointerEvent): Pt => {
    const overlay = e.currentTarget as HTMLElement;
    const r = overlay.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / fitScale,
      y: (e.clientY - r.top) / fitScale,
    };
  };

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  /* ── element deletion (registers true text removal for native lines) ── */
  const deleteElement = useCallback(
    (pageIdx: number, id: string) => {
      const el = (elsRef.current[pageIdx] ?? []).find((x) => x.id === id);
      if (el && el.type === "text" && typeof el.nativeId === "number") {
        const nid = el.nativeId;
        setRemovedNative((m) => ({ ...m, [pageIdx]: [...(m[pageIdx] ?? []), nid] }));
        schedulePreview(); // wipe the line from the on-screen page too
      }
      setElements((m) => ({
        ...m,
        [pageIdx]: (m[pageIdx] ?? []).filter((x) => x.id !== id),
      }));
    },
    [schedulePreview]
  );

  /* sample the page colour beside a text line — the opaque underlay that
     hides the original glyphs while the user is typing */
  const samplePageBg = (x: number, y: number, w: number, h: number): string => {
    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return "#ffffff";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = (v: number) => Math.round(v * fitScale * dpr);
      const cands: Array<[number, number]> = [
        [x - 4, y + h * 0.5],
        [x + w + 4, y + h * 0.5],
        [x + w * 0.5, y - 3],
        [x + w * 0.5, y + h + 3],
      ];
      for (const [cx, cy] of cands) {
        const sx = px(cx);
        const sy = px(cy);
        if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
        const d = ctx.getImageData(sx, sy, 1, 1).data;
        if (d[3] < 10) continue;
        return `rgb(${d[0]},${d[1]},${d[2]})`;
      }
    } catch {
      /* canvas unreadable — plain white fallback */
    }
    return "#ffffff";
  };

  /* ── convert the PDF's own text into an editable element ─────────── */
  const createNativeText = (nb: NativeBox) => {
    // select the element again if this text item is already being edited
    const existing = (elsRef.current[pageNum] ?? []).find(
      (x) => x.type === "text" && x.nativeId === nb.idx
    );
    if (existing) {
      setSelectedId(existing.id);
      focusNewText.current = existing.id;
      setTool("select");
      return;
    }
    pushUndo();
    const id = uid();
    updateEls((els) => [
      ...els,
      {
        id,
        type: "text",
        x: nb.x,
        y: nb.baselineY - nb.size * 0.85,
        w: nb.w + 8,
        text: nb.str,
        size: nb.size,
        color: "#111827",
        bold: false,
        nativeId: nb.idx,
        nativeBox: { x: nb.x, y: nb.y, w: nb.w, h: nb.h },
        nativeParts: nb.parts,
        bg: samplePageBg(nb.x, nb.y, nb.w, nb.h),
      },
    ]);
    setSelectedId(id);
    focusNewText.current = id;
    setTool("select");
  };

  /* ── page ops: duplicate + reorder ──────────────────────────────── */
  const duplicatePage = () => {
    if (alivePages.length >= MAX_PAGES) return;
    pushUndo();
    const pos = pageOrder.indexOf(pageNum);
    setPageOrder((o) => [...o.slice(0, pos + 1), pageNum, ...o.slice(pos + 1)]);
    toast.success(lang === "en" ? "Page duplicated" : "পেজ কপি হয়েছে");
  };

  const movePage = (dir: -1 | 1) => {
    const pos = pageOrder.indexOf(pageNum);
    const swap = pos + dir;
    if (swap < 0 || swap >= pageOrder.length) return;
    pushUndo();
    setPageOrder((o) => {
      const n = [...o];
      [n[pos], n[swap]] = [n[swap], n[pos]];
      return n;
    });
  };

  /* ── pointer interactions ────────────────────────────────────────── */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pdfDoc || e.button !== 0) return;
    const target = e.target as HTMLElement;

    // never hijack the caret when the user is typing inside a text element
    if (target.closest('[contenteditable="true"]')) return;

    if (tool === "select") {
      const handle = target.closest('[data-handle="resize"]');
      const grip = target.closest('[data-handle="move"]');
      const hit = target.closest("[data-el-id]");
      const id = hit?.getAttribute("data-el-id") ?? null;
      setSelectedId(id);
      if (id && (handle || grip)) {
        const el = pageEls.find((x) => x.id === id);
        if (el && el.type === "image" && handle) {
          pushUndo();
          const p = toPt(e);
          dragRef.current = {
            mode: "resize",
            id,
            x0: p.x,
            y0: p.y,
            w0: el.w,
            h0: el.h,
            ratio: el.w / el.h,
          };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } else if (el && el.type === "shape" && !grip) {
          pushUndo();
          const p = toPt(e);
          dragRef.current = { mode: "move", id, offX: p.x, offY: p.y, lx: p.x, ly: p.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } else if (el && el.type !== "draw" && el.type !== "shape" && grip) {
          // text moves via its grip so clicks inside the box place the caret
          pushUndo();
          const p = toPt(e);
          dragRef.current = { mode: "move", id, offX: p.x - el.x, offY: p.y - el.y, lx: p.x, ly: p.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
      } else if (id) {
        const el = pageEls.find((x) => x.id === id);
        if (el && el.type === "shape") {
          const p = toPt(e);
          pushUndo();
          dragRef.current = { mode: "move", id, offX: p.x, offY: p.y, lx: p.x, ly: p.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } else if (el && el.type !== "draw" && el.type !== "text") {
          const p = toPt(e);
          pushUndo();
          dragRef.current = { mode: "move", id, offX: p.x - el.x, offY: p.y - el.y, lx: p.x, ly: p.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } else if (el && el.type === "text") {
          // clicking a text element places the caret inside it
          focusNewText.current = el.id;
        }
      }
      return;
    }

    if (tool === "whiteout" || tool === "highlight" || tool === "redact" || tool === "shape") {
      const p = toPt(e);
      pushUndo();
      dragRef.current = { mode: "rect", x0: p.x, y0: p.y };
      setDraftRect({ x: p.x, y: p.y, w: 0, h: 0 });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "text") {
      const p = toPt(e);
      pushUndo();
      const id = uid();
      updateEls((els) => [
        ...els,
        {
          id,
          type: "text",
          x: p.x,
          y: p.y - textSize / 2,
          w: 120,
          text: "",
          size: textSize,
          color,
          bold: false,
        },
      ]);
      setSelectedId(id);
      focusNewText.current = id;
      return;
    }

    if (tool === "draw") {
      pushUndo();
      dragRef.current = { mode: "draw" };
      setDraftPath([toPt(e)]);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toPt(e);

    if (drag.mode === "move") {
      const dx = p.x - drag.lx;
      const dy = p.y - drag.ly;
      updateEls((els) =>
        els.map((el) => {
          if (el.id !== drag.id || el.type === "draw") return el;
          if (el.type === "shape") {
            return {
              ...el,
              x0: clamp(el.x0 + dx, -disp.w, disp.w * 2),
              y0: clamp(el.y0 + dy, -disp.h, disp.h * 2),
              x1: clamp(el.x1 + dx, -disp.w, disp.w * 2),
              y1: clamp(el.y1 + dy, -disp.h, disp.h * 2),
            };
          }
          const w = el.type === "text" ? Math.min(el.w, disp.w) : el.w;
          const h = el.type === "text" ? el.size : el.h;
          return {
            ...el,
            x: clamp(p.x - drag.offX, -w / 2, disp.w - w / 2),
            y: clamp(p.y - drag.offY, -h / 2, disp.h - h / 2),
          };
        })
      );
      dragRef.current = { ...drag, lx: p.x, ly: p.y };
    } else if (drag.mode === "resize") {
      updateEls((els) =>
        els.map((el) => {
          if (el.id !== drag.id || el.type !== "image") return el;
          const dw = p.x - drag.x0;
          let nw = drag.w0 + dw;
          let nh = nw / drag.ratio;
          if (nw < 20) {
            nw = 20;
            nh = 20 / drag.ratio;
          }
          if (nh < 20) {
            nh = 20;
            nw = 20 * drag.ratio;
          }
          return { ...el, w: nw, h: nh };
        })
      );
    } else if (drag.mode === "rect") {
      setDraftRect({
        x: Math.min(drag.x0, p.x),
        y: Math.min(drag.y0, p.y),
        w: Math.abs(p.x - drag.x0),
        h: Math.abs(p.y - drag.y0),
      });
    } else if (drag.mode === "draw") {
      setDraftPath((pts) => {
        const last = pts?.[pts.length - 1];
        if (!pts) return pts;
        if (last && Math.hypot(p.x - last.x, p.y - last.y) * fitScale < 2) return pts;
        return [...pts, p];
      });
    }
  };

  const onPointerUp = (e?: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.mode === "rect" && draftRect) {
      const { x, y, w, h } = draftRect;
      setDraftRect(null);
      if (w < 3 || h < 3) return; // accidental click
      if (tool === "whiteout") {
        updateEls((els) => [...els, { id: uid(), type: "whiteout", x, y, w, h }]);
      } else if (tool === "highlight") {
        updateEls((els) => [...els, { id: uid(), type: "highlight", x, y, w, h, color }]);
      } else if (tool === "redact") {
        updateEls((els) => [...els, { id: uid(), type: "redact", x, y, w, h }]);
      } else if (tool === "shape") {
        let x0 = drag.x0;
        let y0 = drag.y0;
        let x1 = x + w;
        let y1 = y + h;
        if ((shapeKind === "line" || shapeKind === "arrow") && e) {
          const p = toPt(e);
          x1 = p.x;
          y1 = p.y;
        }
        updateEls((els) => [
          ...els,
          { id: uid(), type: "shape", shape: shapeKind, x0, y0, x1, y1, color, width: strokeW },
        ]);
      }
    }
    if (drag.mode === "draw" && draftPath) {
      const pts = draftPath;
      setDraftPath(null);
      if (pts.length > 1) {
        updateEls((els) => [
          ...els,
          { id: uid(), type: "draw", color, width: strokeW, points: pts },
        ]);
      }
    }
  };

  /* ── page ops ────────────────────────────────────────────────────── */
  const alivePages = useMemo(
    () =>
      (pageOrder.length ? pageOrder : Array.from({ length: pageCount }, (_, i) => i)).filter(
        (i) => !deleted.includes(i)
      ),
    [pageOrder, pageCount, deleted]
  );

  const gotoPage = (dir: 1 | -1) => {
    const idx = alivePages.indexOf(pageNum);
    const next = alivePages[idx + dir];
    if (next !== undefined) {
      setPageNum(next);
      setSelectedId(null);
    }
  };

  const rotatePage = () => {
    pushUndo();
    const cur = rotation[pageNum] ?? 0;
    setRotation((m) => ({ ...m, [pageNum]: (cur + 90) % 360 }));
    // elements follow the page (rotate 90° CW in display space)
    const oldH = disp.h;
    updateEls((els) => rotateElsCW(els, oldH));
    setSelectedId(null);
  };

  const deletePage = () => {
    if (alivePages.length <= 1) {
      toast.error(lang === "en" ? "The last page cannot be deleted" : "শেষ পেজটি ডিলিট করা যাবে না");
      return;
    }
    pushUndo();
    setDeleted((d) => [...d, pageNum]);
    setSelectedId(null);
    const idx = alivePages.indexOf(pageNum);
    setPageNum(alivePages[idx + 1] ?? alivePages[idx - 1] ?? 0);
  };

  const clearPage = () => {
    if ((elements[pageNum] ?? []).length === 0) return;
    pushUndo();
    updateEls(() => []);
    setSelectedId(null);
  };

  /* ── image insert (file picker + signature pad share this) ──────── */
  const addImageEl = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      // fit into page (max 60% of the shorter side)
      const maxW = disp.w * 0.6;
      const maxH = disp.h * 0.6;
      const r = img.width / img.height;
      let w = maxW;
      let h = w / r;
      if (h > maxH) {
        h = maxH;
        w = h * r;
      }
      pushUndo();
      const id = uid();
      updateEls((els) => [
        ...els,
        { id, type: "image", x: (disp.w - w) / 2, y: (disp.h - h) / 2, w, h, dataUrl },
      ]);
      setSelectedId(id);
      setTool("select");
    };
    img.src = dataUrl;
  };

  const insertImage = (file: File | undefined | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // downscale huge images for smooth editing
        const max = 1600;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        addImageEl(c.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  /* ── export via pdf-lib: true text surgery + element rendering ───── */
  const savePdf = async () => {
    if (!pdfDoc || !bytesRef.current || saving) return;
    setSaving(true);
    try {
      const { PDFDocument, degrees, rgb } = await import("pdf-lib");
      const pdf = await PDFDocument.load(bytesRef.current.slice(), { ignoreEncryption: true });
      const pages = pdf.getPages();
      const fontStack = getComputedStyle(document.body).fontFamily || "sans-serif";

      for (const i of alivePages) {
        const page = pages[i];
        if (!page) continue;
        const baseRot = ((page.getRotation().angle % 360) + 360) % 360;
        const rot = (baseRot + (rotation[i] ?? 0)) % 360;
        page.setRotation(degrees(rot));

        const { width: Wu, height: Hu } = page.getSize();
        const jsPage: PdfJsPage = await pdfDoc.getPage(i + 1);
        const vp1 = jsPage.getViewport({ scale: 1, rotation: rot });
        const Wd = vp1.width;
        const Hd = vp1.height;
        const els = elements[i] ?? [];

        const place = (x: number, y: number, w: number, h: number) => {
          const m = mapRect(x, y, w, h, rot, Wd, Hd);
          return { x: m.x, y: Hu - m.y - m.h, width: m.w, height: m.h };
        };
        const placePt = (x: number, y: number) => {
          const m = mapPt(x, y, rot, Wd, Hd);
          return { x: m.x, y: Hu - m.y };
        };

        /* ── 1) TRUE TEXT SURGERY — remove the original operators ──── */
        const rects: UserRect[] = computeNativeRects(i, rot, Wu, Hu, true);
        if (rects.length > 0) {
          await removeTextInRects(pdf, i, rects);
        }

        /* ── 2) draw the annotation / replacement elements ─────────── */
        for (const el of els) {
          if (el.type === "whiteout") {
            page.drawRectangle({ ...place(el.x, el.y, el.w, el.h), color: rgb(1, 1, 1) });
          } else if (el.type === "highlight") {
            const c = hexToRgb01(el.color);
            page.drawRectangle({ ...place(el.x, el.y, el.w, el.h), color: rgb(c.r, c.g, c.b), opacity: 0.35 });
          } else if (el.type === "redact") {
            page.drawRectangle({ ...place(el.x, el.y, el.w, el.h), color: rgb(0, 0, 0) });
          } else if (el.type === "image") {
            const png = await pdf.embedPng(el.dataUrl);
            page.drawImage(png, place(el.x, el.y, el.w, el.h));
          } else if (el.type === "shape") {
            const c = hexToRgb01(el.color);
            const col = rgb(c.r, c.g, c.b);
            if (el.shape === "rect") {
              const p0 = placePt(Math.min(el.x0, el.x1), Math.min(el.y0, el.y1));
              const p1 = placePt(Math.max(el.x0, el.x1), Math.max(el.y0, el.y1));
              page.drawRectangle({
                x: p0.x,
                y: p1.y,
                width: Math.abs(p1.x - p0.x),
                height: Math.abs(p1.y - p0.y),
                borderColor: col,
                borderWidth: el.width,
              });
            } else if (el.shape === "ellipse") {
              const a = placePt(el.x0, el.y0);
              const b = placePt(el.x1, el.y1);
              page.drawEllipse({
                x: (a.x + b.x) / 2,
                y: (a.y + b.y) / 2,
                xScale: Math.abs(b.x - a.x) / 2,
                yScale: Math.abs(b.y - a.y) / 2,
                borderColor: col,
                borderWidth: el.width,
              });
            } else {
              const a = placePt(el.x0, el.y0);
              const b = placePt(el.x1, el.y1);
              page.drawLine({ start: a, end: b, color: col, thickness: el.width });
              if (el.shape === "arrow") {
                // chevron head
                const ang = Math.atan2(b.y - a.y, b.x - a.x);
                const hs = Math.max(8, el.width * 3.2);
                for (const off of [Math.PI * 0.82, -Math.PI * 0.82]) {
                  page.drawLine({
                    start: b,
                    end: {
                      x: b.x + Math.cos(ang + off) * hs,
                      y: b.y + Math.sin(ang + off) * hs,
                    },
                    color: col,
                    thickness: el.width,
                  });
                }
              }
            }
          } else if (el.type === "text") {
            const text = el.text.trim() ? el.text : "";
            if (!text) continue;
            const lines = text.split("\n");
            const S = 3; // raster scale for crisp text
            const lh = el.size * 1.35;
            const meas = document.createElement("canvas").getContext("2d")!;
            meas.font = `${el.bold ? "600 " : ""}${el.size * S}px ${fontStack}`;
            const wPx = Math.max(...lines.map((l) => meas.measureText(l).width));
            const hPx = lines.length * lh * S;
            const c = document.createElement("canvas");
            c.width = Math.ceil(wPx + 8 * S);
            c.height = Math.ceil(hPx + 4 * S);
            const ctx = c.getContext("2d")!;
            ctx.font = `${el.bold ? "600 " : ""}${el.size * S}px ${fontStack}`;
            ctx.fillStyle = el.color;
            ctx.textBaseline = "top";
            lines.forEach((line, li) => ctx.fillText(line, 4 * S, 2 * S + li * lh * S));
            const png = await pdf.embedPng(c.toDataURL("image/png"));
            page.drawImage(png, place(el.x, el.y, c.width / S, c.height / S));
          } else if (el.type === "draw") {
            // rasterize all draw strokes per element into its bbox
            const xs = el.points.map((p) => p.x);
            const ys = el.points.map((p) => p.y);
            const pad = el.width + 2;
            const bx = Math.max(0, Math.min(...xs) - pad);
            const by = Math.max(0, Math.min(...ys) - pad);
            const bw = Math.min(Wd, Math.max(...xs) + pad) - bx;
            const bh = Math.min(Hd, Math.max(...ys) + pad) - by;
            if (bw <= 0 || bh <= 0) continue;
            const S = 2;
            const c = document.createElement("canvas");
            c.width = Math.ceil(bw * S);
            c.height = Math.ceil(bh * S);
            const ctx = c.getContext("2d")!;
            ctx.strokeStyle = el.color;
            ctx.lineWidth = el.width * S;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            el.points.forEach((p, pi) => {
              const px = (p.x - bx) * S;
              const py = (p.y - by) * S;
              if (pi === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            });
            ctx.stroke();
            const png = await pdf.embedPng(c.toDataURL("image/png"));
            page.drawImage(png, place(bx, by, bw, bh));
          }
        }
      }

      /* ── 3) assemble final page order (delete / reorder / duplicate) ── */
      const order = alivePages.filter((i) => i < pdf.getPageCount());
      const identity =
        order.length === pdf.getPageCount() && order.every((v, k) => v === k);
      let outBytes: Uint8Array;
      if (identity) {
        outBytes = await pdf.save();
      } else {
        const outDoc = await PDFDocument.create();
        // one copyPages call per position: repeated indices get independent
        // copies (a single call would share one cached page object)
        for (const idx of order) {
          const [p] = await outDoc.copyPages(pdf, [idx]);
          outDoc.addPage(p);
        }
        outBytes = await outDoc.save();
      }

      const blob = new Blob([outBytes as unknown as BlobPart], { type: "application/pdf" });
      const base = fileNameRef.current.replace(/\.pdf$/i, "");
      downloadBlob(blob, `${base}-edited.pdf`);
      setSavedBytes(blob.size);
      toast.success(t("edSaved"));
    } catch {
      toast.error(t("edSaveFail"));
    } finally {
      setSaving(false);
    }
  };

  /* ── derived ─────────────────────────────────────────────────────── */
  const canvasW = disp.w * fitScale;
  const canvasH = disp.h * fitScale;
  const selected = pageEls.find((el) => el.id === selectedId) ?? null;
  const selectedText = selected && selected.type === "text" ? selected : null;
  const boxes = nativeBoxes[`${pageNum}:${totalRot}`] ?? [];
  const editedNativeIds = new Set(
    pageEls.filter((x) => x.type === "text" && typeof x.nativeId === "number").map((x) => (x as { nativeId: number }).nativeId)
  );
  const removedNativeIds = new Set(removedNative[pageNum] ?? []);

  const TOOL_BTN: { id: ToolId; icon: typeof Type; label: string }[] = [
    { id: "select", icon: MousePointer2, label: t("edToolSelect") },
    { id: "editText", icon: TextCursorInput, label: t("edToolEditText") },
    { id: "whiteout", icon: Eraser, label: t("edToolWhiteout") },
    { id: "redact", icon: EyeOff, label: t("edToolRedact") },
    { id: "highlight", icon: Highlighter, label: t("edToolHighlight") },
    { id: "text", icon: Type, label: t("edToolText") },
    { id: "shape", icon: Shapes, label: t("edToolShape") },
    { id: "draw", icon: Circle, label: t("edToolDraw") },
  ];

  /* ═══════════════════════════════════ render ═══════════════════════ */

  if (!pdfDoc) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:px-6" aria-label={t("edEditorAria")}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="fm-card rounded-3xl p-8 text-center sm:p-12"
        >
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-500/30">
            <UploadCloud className="h-8 w-8 text-white" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-emerald-950 sm:text-2xl">{t("edTitle")}</h1>
          <p className="mt-2 text-sm text-emerald-900/60">{t("edDropHint")}</p>

          {loading ? (
            <div className="mt-8 flex items-center justify-center gap-2 text-emerald-700">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">{t("edLoading")}</span>
            </div>
          ) : (
            <>
              <div
                role="button"
                tabIndex={0}
                aria-label={t("edPick")}
                onClick={() => pdfInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") pdfInputRef.current?.click();
                }}
                className="mt-8 cursor-pointer rounded-2xl border-2 border-dashed border-rose-500/25 bg-rose-50/40 px-6 py-10 outline-none transition hover:border-rose-500/50 hover:bg-rose-50/70 focus-visible:ring-2 focus-visible:ring-rose-500/50"
              >
                <p className="font-semibold text-emerald-950/85">{t("edDrop")}</p>
                <Button className="btn-shine mt-4 bg-gradient-to-r from-rose-500 to-red-600 shadow-lg shadow-rose-500/25 hover:from-rose-600 hover:to-red-700">
                  {t("edPick")}
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-emerald-900/50">
                {[
                  `${t("edToolEditText")} · ${t("edToolWhiteout")} · ${t("edToolText")} · ${t("edToolImage")} · ${t("edToolRedact")} · ${t("edToolShape")} · ${t("edSignature")}`,
                  t("edRotate"),
                  t("edDeletePage"),
                ].map((chip, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-emerald-600/10 bg-emerald-50/70 px-3 py-1 font-medium"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </>
          )}

          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              openFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </motion.div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[calc(100vh-4rem)] flex-col" aria-label={t("edEditorAria")}>
      {/* ── toolbar row 1: doc + page + save ─────────────────────────── */}
      <div className="sticky top-16 z-20 border-b border-emerald-900/[0.06] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={goHome}
            className="h-9 text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
            aria-label={t("edBack")}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{t("edBack")}</span>
          </Button>

          <span className="hidden min-w-0 max-w-[180px] truncate text-sm font-semibold text-emerald-950 md:block">
            {fileNameRef.current}
          </span>

          {/* page nav */}
          <div className="ml-auto flex items-center gap-1 rounded-xl border border-emerald-900/[0.07] bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => gotoPage(-1)}
              disabled={alivePages.indexOf(pageNum) <= 0}
              aria-label={lang === "en" ? "Previous page" : "আগের পেজ"}
              className="rounded-lg p-1.5 text-emerald-900/70 transition hover:bg-emerald-50 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-14 text-center text-xs font-semibold tabular-nums text-emerald-950">
              {num(pageNum + 1)} / {num(alivePages.length)}
            </span>
            <button
              type="button"
              onClick={() => gotoPage(1)}
              disabled={alivePages.indexOf(pageNum) >= alivePages.length - 1}
              aria-label={lang === "en" ? "Next page" : "পরের পেজ"}
              className="rounded-lg p-1.5 text-emerald-900/70 transition hover:bg-emerald-50 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={undoStack.current.length === 0}
              aria-label={t("edUndo")}
              title={t("edUndo")}
              className="rounded-xl border border-emerald-900/[0.07] bg-white p-2 text-emerald-900/70 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-30"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={rotatePage}
              aria-label={t("edRotate")}
              title={t("edRotate")}
              className="rounded-xl border border-emerald-900/[0.07] bg-white p-2 text-emerald-900/70 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={duplicatePage}
              aria-label={t("edDupPage")}
              title={t("edDupPage")}
              className="rounded-xl border border-emerald-900/[0.07] bg-white p-2 text-emerald-900/70 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={deletePage}
              aria-label={t("edDeletePage")}
              title={t("edDeletePage")}
              className="rounded-xl border border-rose-600/15 bg-white p-2 text-rose-600/80 shadow-sm transition hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={savePdf}
            disabled={saving}
            className="btn-shine inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-500/25 transition hover:brightness-105 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden sm:inline">{saving ? t("edSaving") : t("edSave")}</span>
            {savedBytes !== null && !saving && (
              <span className="hidden text-[10px] font-medium opacity-80 lg:inline">
                {formatBytes(savedBytes)}
              </span>
            )}
          </button>
        </div>

        {/* ── toolbar row 2: tools + options ─────────────────────────── */}
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-1.5 px-3 pb-2.5 sm:px-5">
          {TOOL_BTN.map(({ id: tl, icon: Icon, label }) => (
            <button
              key={tl}
              type="button"
              onClick={() => {
                setTool(tl);
                setSelectedId(null);
              }}
              aria-pressed={tool === tl}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${
                tool === tl
                  ? "bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/25"
                  : "border border-emerald-900/[0.07] bg-white text-emerald-900/70 shadow-sm hover:bg-emerald-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className={tl === "select" ? "sr-only sm:inline" : ""}>{label}</span>
            </button>
          ))}

          {/* image insert */}
          <button
            type="button"
            onClick={() => imgInputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-900/[0.07] bg-white px-2.5 text-xs font-semibold text-emerald-900/70 shadow-sm transition hover:bg-emerald-50"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("edToolImage")}</span>
          </button>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => {
              insertImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {/* signature pad */}
          <button
            type="button"
            onClick={() => setSigOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-900/[0.07] bg-white px-2.5 text-xs font-semibold text-emerald-900/70 shadow-sm transition hover:bg-emerald-50"
          >
            <PenTool className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("edSignature")}</span>
          </button>

          <span className="mx-1 hidden h-5 w-px bg-emerald-900/10 sm:block" />

          {/* color */}
          <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-900/[0.07] bg-white px-2 text-xs font-semibold text-emerald-900/70 shadow-sm">
            {tool === "draw" ? t("edStroke") : t("edColor")}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label={t("edColor")}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>

          {/* shape kind chips */}
          {tool === "shape" && (
            <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-900/[0.07] bg-white px-1 shadow-sm">
              {(
                [
                  ["rect", Square, t("edShapeRect")],
                  ["ellipse", Circle, t("edShapeEllipse")],
                  ["line", Minus, t("edShapeLine")],
                  ["arrow", ArrowUpRight, t("edShapeArrow")],
                ] as const
              ).map(([k, Icon, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setShapeKind(k)}
                  aria-pressed={shapeKind === k}
                  aria-label={label}
                  title={label}
                  className={`grid h-6 w-6 place-items-center rounded-md transition ${
                    shapeKind === k
                      ? "bg-rose-500 text-white shadow-sm"
                      : "text-emerald-900/60 hover:bg-emerald-50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </span>
          )}

          {/* size slider (draw) */}
          {tool === "draw" && (
            <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-emerald-900/[0.07] bg-white px-2.5 text-xs font-semibold text-emerald-900/70 shadow-sm">
              {strokeW}px
              <input
                type="range"
                min={1}
                max={24}
                value={strokeW}
                onChange={(e) => setStrokeW(Number(e.target.value))}
                aria-label={t("edStroke")}
                className="h-1.5 w-16 accent-rose-600"
              />
            </label>
          )}

          {/* shape stroke width */}
          {tool === "shape" && (
            <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-emerald-900/[0.07] bg-white px-2.5 text-xs font-semibold text-emerald-900/70 shadow-sm">
              {strokeW}px
              <input
                type="range"
                min={1}
                max={24}
                value={strokeW}
                onChange={(e) => setStrokeW(Number(e.target.value))}
                aria-label={t("edStroke")}
                className="h-1.5 w-16 accent-rose-600"
              />
            </label>
          )}

          {/* text size — new text tool or the selected text element */}
          {(tool === "text" || selectedText) && (
            <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-emerald-900/[0.07] bg-white px-2.5 text-xs font-semibold text-emerald-900/70 shadow-sm">
              {selectedText ? Math.round(selectedText.size) : textSize}px
              <input
                type="range"
                min={8}
                max={72}
                value={selectedText ? Math.round(selectedText.size) : textSize}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (selectedText) {
                    updateEls((els) =>
                      els.map((x) =>
                        x.id === selectedText.id && x.type === "text" ? { ...x, size: v } : x
                      )
                    );
                  } else {
                    setTextSize(v);
                  }
                }}
                aria-label={t("edTextSize")}
                className="h-1.5 w-16 accent-rose-600"
              />
              {selectedText && (
                <button
                  type="button"
                  onClick={() =>
                    updateEls((els) =>
                      els.map((x) =>
                        x.id === selectedText.id && x.type === "text"
                          ? { ...x, bold: !x.bold }
                          : x
                      )
                    )
                  }
                  aria-pressed={selectedText.bold}
                  aria-label={t("edBold")}
                  title={t("edBold")}
                  className={`grid h-6 w-6 place-items-center rounded-md text-[11px] font-black transition ${
                    selectedText.bold
                      ? "bg-rose-500 text-white shadow-sm"
                      : "text-emerald-900/60 hover:bg-emerald-50"
                  }`}
                >
                  B
                </button>
              )}
            </label>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={clearPage}
              aria-label={t("edClearPage")}
              title={t("edClearPage")}
              className="rounded-lg border border-emerald-900/[0.07] bg-white p-1.5 text-emerald-900/60 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
              aria-label={t("edZoomOut")}
              className="rounded-lg border border-emerald-900/[0.07] bg-white p-1.5 text-emerald-900/60 shadow-sm transition hover:bg-emerald-50"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-10 text-center text-[11px] font-semibold tabular-nums text-emerald-900/60">
              {num(Math.round(zoom * 100))}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
              aria-label={t("edZoomIn")}
              className="rounded-lg border border-emerald-900/[0.07] bg-white p-1.5 text-emerald-900/60 shadow-sm transition hover:bg-emerald-50"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── body: thumbs + canvas stage ─────────────────────────────── */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-4 px-3 py-4 sm:px-5">
        {/* thumbnails */}
        <aside
          aria-label={t("edThumbs")}
          className="fm-scroll hidden w-24 shrink-0 flex-col gap-2 overflow-y-auto md:flex"
        >
          {alivePages.map((i, pos) => (
            <button
              key={`${i}-${pos}`}
              type="button"
              onClick={() => {
                setPageNum(i);
                setSelectedId(null);
              }}
              aria-current={i === pageNum}
              className={`group relative overflow-hidden rounded-lg border-2 transition ${
                i === pageNum
                  ? "border-rose-500 shadow-md shadow-rose-500/20"
                  : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              {thumbs[i] ? (
                <img src={thumbs[i]} alt="" className="w-full" draggable={false} />
              ) : (
                <span className="grid h-28 w-full place-items-center bg-emerald-50 text-xs font-semibold text-emerald-900/60">
                  {num(i + 1)}
                </span>
              )}
              <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">
                {num(i + 1)}
              </span>
            </button>
          ))}
        </aside>

        {/* stage */}
        <div
          ref={stageRef}
          className="fm-scroll flex-1 overflow-auto rounded-2xl border border-emerald-900/[0.06] bg-emerald-50/50 p-4 [background-image:radial-gradient(rgba(5,150,105,0.09)_1px,transparent_1px)] [background-size:18px_18px]"
        >
          {tool === "editText" && (
            <div className="mb-3 flex justify-center">
              <span className="rounded-full border border-emerald-600/15 bg-white/90 px-3 py-1 text-center text-[11px] font-semibold text-emerald-900/70 shadow-sm">
                {scanningText
                  ? lang === "en"
                    ? "Scanning text…"
                    : "টেক্সট খোঁজা হচ্ছে…"
                  : boxes.length === 0
                    ? t("edNoNativeText")
                    : lang === "en"
                      ? `${boxes.length} text line${boxes.length > 1 ? "s" : ""} — click one to edit in place · clear it to delete`
                      : `${num(boxes.length)} টি টেক্সট লাইন — ক্লিক করে সরাসরি এডিট · লেখা সব মুছে দিলে লাইনটি ডিলিট হবে`}
              </span>
            </div>
          )}
          <div
            className="relative mx-auto bg-white shadow-[0_18px_50px_-18px_rgba(13,31,22,0.35)]"
            style={{ width: canvasW, height: canvasH }}
          >
            <canvas ref={canvasRef} className="block" style={{ width: canvasW, height: canvasH }} />

            {/* interaction overlay */}
            <div
              className="absolute inset-0 touch-none select-none [&_[contenteditable='true']]:select-text"
              style={{
                cursor:
                  tool === "select"
                    ? "default"
                    : tool === "editText"
                      ? "text"
                      : "crosshair",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={(e) => {
                // double-click any text — even with the select tool — to edit it in place
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const px = (e.clientX - r.left) / fitScale;
                const py = (e.clientY - r.top) / fitScale;
                const hit = boxes.find(
                  (nb) =>
                    !removedNativeIds.has(nb.idx) &&
                    px >= nb.x - 2 &&
                    px <= nb.x + nb.w + 2 &&
                    py >= nb.y - 2 &&
                    py <= nb.y + nb.h + 2
                );
                if (hit) {
                  e.stopPropagation();
                  e.preventDefault();
                  createNativeText(hit);
                }
              }}
              // the browser would blur our freshly-focused text box otherwise
              onMouseDown={(me) => {
                if (tool === "text") me.preventDefault();
              }}
              role="application"
              aria-label={t("edEditorAria")}
            >
              {/* rects */}
              {pageEls.map((el) =>
                el.type === "whiteout" ? (
                  <div
                    key={el.id}
                    data-el-id={el.id}
                    className={`absolute bg-white ${selectedId === el.id ? "outline-2 outline-dashed outline-rose-500" : "outline-1 outline-dashed outline-rose-300/0 hover:outline-rose-300/70"}`}
                    style={{
                      left: el.x * fitScale,
                      top: el.y * fitScale,
                      width: el.w * fitScale,
                      height: el.h * fitScale,
                    }}
                  >
                    {selectedId === el.id && (
                      <button
                        type="button"
                        aria-label={t("edDeleteEl")}
                        onClick={(e) => {
                          e.stopPropagation();
                          pushUndo();
                          updateEls((els) => els.filter((x) => x.id !== el.id));
                          setSelectedId(null);
                        }}
                        className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow-md"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ) : el.type === "highlight" ? (
                  <div
                    key={el.id}
                    data-el-id={el.id}
                    className={`absolute mix-blend-multiply ${selectedId === el.id ? "outline-2 outline-dashed outline-rose-500" : "outline-1 outline-dashed outline-rose-300/0 hover:outline-rose-300/70"}`}
                    style={{
                      left: el.x * fitScale,
                      top: el.y * fitScale,
                      width: el.w * fitScale,
                      height: el.h * fitScale,
                      backgroundColor: el.color,
                      opacity: 0.35,
                      borderRadius: 2,
                    }}
                  >
                    {selectedId === el.id && (
                      <button
                        type="button"
                        aria-label={t("edDeleteEl")}
                        onClick={(e) => {
                          e.stopPropagation();
                          pushUndo();
                          updateEls((els) => els.filter((x) => x.id !== el.id));
                          setSelectedId(null);
                        }}
                        className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow-md"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ) : el.type === "redact" ? (
                  <div
                    key={el.id}
                    data-el-id={el.id}
                    className={`absolute bg-black ${selectedId === el.id ? "outline-2 outline-dashed outline-rose-500" : "outline-1 outline-dashed outline-transparent hover:outline-rose-300/70"}`}
                    style={{
                      left: el.x * fitScale,
                      top: el.y * fitScale,
                      width: el.w * fitScale,
                      height: el.h * fitScale,
                    }}
                  >
                    <span className="pointer-events-none absolute inset-1 rounded-[3px] border border-dashed border-white/40" />
                    {selectedId === el.id && (
                      <button
                        type="button"
                        aria-label={t("edDeleteEl")}
                        onClick={(e) => {
                          e.stopPropagation();
                          pushUndo();
                          updateEls((els) => els.filter((x) => x.id !== el.id));
                          setSelectedId(null);
                        }}
                        className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow-md"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ) : null
              )}

              {/* images */}
              {pageEls.map((el) =>
                el.type === "image" ? (
                  <div
                    key={el.id}
                    data-el-id={el.id}
                    className={`absolute ${selectedId === el.id ? "outline-2 outline-dashed outline-rose-500" : "outline-1 outline-dashed outline-transparent hover:outline-rose-300/70"}`}
                    style={{
                      left: el.x * fitScale,
                      top: el.y * fitScale,
                      width: el.w * fitScale,
                      height: el.h * fitScale,
                    }}
                  >
                    <img
                      src={el.dataUrl}
                      alt=""
                      draggable={false}
                      className="h-full w-full select-none"
                    />
                    {selectedId === el.id && (
                      <>
                        <button
                          type="button"
                          aria-label={t("edDeleteEl")}
                          onClick={(e) => {
                            e.stopPropagation();
                            pushUndo();
                            updateEls((els) => els.filter((x) => x.id !== el.id));
                            setSelectedId(null);
                          }}
                          className="absolute -right-2.5 -top-2.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow-md"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <span
                          data-handle="resize"
                          className="absolute -bottom-2 -right-2 z-10 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-rose-600 shadow-md"
                        />
                      </>
                    )}
                  </div>
                ) : null
              )}

              {/* draw layer */}
              <svg
                className="pointer-events-none absolute inset-0"
                width={canvasW}
                height={canvasH}
                viewBox={`0 0 ${disp.w} ${disp.h}`}
                aria-hidden="true"
              >
                {pageEls.map((el) =>
                  el.type === "draw" ? (
                    <polyline
                      key={el.id}
                      points={el.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke={el.color}
                      strokeWidth={el.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null
                )}
                {draftPath && draftPath.length > 1 && (
                  <polyline
                    points={draftPath.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>

              {/* shapes layer */}
              <svg
                className="absolute inset-0 overflow-visible"
                width={canvasW}
                height={canvasH}
                viewBox={`0 0 ${disp.w} ${disp.h}`}
              >
                {pageEls.map((el) => {
                  if (el.type !== "shape") return null;
                  const common = {
                    fill: "none" as const,
                    stroke: el.color,
                    strokeWidth: el.width,
                    strokeLinecap: "round" as const,
                    strokeLinejoin: "round" as const,
                  };
                  const hitW = Math.max(el.width + 10, 14);
                  const x = Math.min(el.x0, el.x1);
                  const y = Math.min(el.y0, el.y1);
                  const w = Math.abs(el.x1 - el.x0);
                  const h = Math.abs(el.y1 - el.y0);
                  const ang = Math.atan2(el.y1 - el.y0, el.x1 - el.x0);
                  const hs = Math.max(8, el.width * 3.2);
                  return (
                    <g key={el.id} className="cursor-move">
                      {/* fat invisible hit area */}
                      {el.shape === "rect" && (
                        <rect
                          data-el-id={el.id}
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={hitW}
                        />
                      )}
                      {el.shape === "ellipse" && (
                        <ellipse
                          data-el-id={el.id}
                          cx={x + w / 2}
                          cy={y + h / 2}
                          rx={w / 2}
                          ry={h / 2}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={hitW}
                        />
                      )}
                      {(el.shape === "line" || el.shape === "arrow") && (
                        <line
                          data-el-id={el.id}
                          x1={el.x0}
                          y1={el.y0}
                          x2={el.x1}
                          y2={el.y1}
                          stroke="transparent"
                          strokeWidth={hitW}
                          strokeLinecap="round"
                        />
                      )}
                      {/* visible shape */}
                      {el.shape === "rect" && (
                        <rect {...common} x={x} y={y} width={w} height={h} />
                      )}
                      {el.shape === "ellipse" && (
                        <ellipse {...common} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
                      )}
                      {el.shape === "line" && (
                        <line {...common} x1={el.x0} y1={el.y0} x2={el.x1} y2={el.y1} />
                      )}
                      {el.shape === "arrow" && (
                        <>
                          <line {...common} x1={el.x0} y1={el.y0} x2={el.x1} y2={el.y1} />
                          {[Math.PI * 0.82, -Math.PI * 0.82].map((off) => (
                            <line
                              key={off}
                              {...common}
                              x1={el.x1}
                              y1={el.y1}
                              x2={el.x1 + Math.cos(ang + off) * hs}
                              y2={el.y1 + Math.sin(ang + off) * hs}
                            />
                          ))}
                        </>
                      )}
                      {selectedId === el.id && (
                        <rect
                          x={x - 3}
                          y={y - 3}
                          width={w + 6}
                          height={h + 6}
                          fill="none"
                          stroke="rgba(244,63,94,0.9)"
                          strokeWidth={1}
                          strokeDasharray="5 4"
                        />
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* selected shape delete button */}
              {pageEls.map((el) =>
                el.type === "shape" && selectedId === el.id ? (
                  <button
                    key={el.id}
                    type="button"
                    aria-label={t("edDeleteEl")}
                    onClick={(e) => {
                      e.stopPropagation();
                      pushUndo();
                      updateEls((els) => els.filter((x) => x.id !== el.id));
                      setSelectedId(null);
                    }}
                    className="absolute -top-3 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow-md"
                    style={{
                      left:
                        Math.min(el.x0, el.x1) * fitScale +
                        (Math.abs(el.x1 - el.x0) * fitScale) / 2 -
                        10,
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null
              )}

              {/* the PDF's own text — click to edit natively */}
              {tool === "editText" &&
                boxes
                  .filter((nb) => !removedNativeIds.has(nb.idx))
                  .map((nb) => {
                    const used = editedNativeIds.has(nb.idx);
                    return (
                      <div
                        key={nb.idx}
                        role="button"
                        tabIndex={-1}
                        aria-label={nb.str}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          createNativeText(nb);
                        }}
                        title={nb.str}
                        className={`absolute cursor-text rounded-[2px] border border-dashed transition ${
                          used
                            ? "border-emerald-500/25 bg-emerald-500/[0.03]"
                            : "border-emerald-500/45 bg-emerald-500/[0.06] hover:border-emerald-600 hover:bg-emerald-500/15"
                        }`}
                        style={{
                          left: nb.x * fitScale,
                          top: nb.y * fitScale,
                          width: nb.w * fitScale,
                          height: nb.h * fitScale,
                        }}
                      />
                    );
                  })}

              {/* rect draft */}
              {draftRect && (
                <div
                  className={`pointer-events-none absolute ${tool === "whiteout" ? "bg-white" : ""}`}
                  style={{
                    left: draftRect.x * fitScale,
                    top: draftRect.y * fitScale,
                    width: draftRect.w * fitScale,
                    height: draftRect.h * fitScale,
                    backgroundColor:
                      tool === "highlight"
                        ? `${color}59`
                        : tool === "redact"
                          ? "rgba(0,0,0,0.75)"
                          : undefined,
                    border: `1.5px dashed ${
                      tool === "highlight" || tool === "shape"
                        ? color
                        : tool === "redact"
                          ? "rgba(16,185,129,0.9)"
                          : "rgba(244,63,94,0.7)"
                    }`,
                  }}
                />
              )}

              {/* text elements */}
              {pageEls.map((el) =>
                el.type === "text" ? (
                  <div
                    key={el.id}
                    data-el-id={el.id}
                    className="absolute"
                    style={{
                      left: el.x * fitScale,
                      top: el.y * fitScale,
                      minWidth: 12,
                    }}
                  >
                    {el.nativeBox && (selectedId === el.id || previewBusy) && (
                      /* opaque underlay — hides the original glyphs while typing
                         and until the WYSIWYG re-render lands (no double-vision) */
                      <div
                        aria-hidden="true"
                        className="absolute rounded-[2px]"
                        style={{
                          left: (el.nativeBox.x - el.x) * fitScale - 2,
                          top: (el.nativeBox.y - el.y) * fitScale - 1,
                          width: el.nativeBox.w * fitScale + 4,
                          height: el.nativeBox.h * fitScale + 2,
                          background: el.bg || "#ffffff",
                        }}
                      />
                    )}
                    {selectedId === el.id && (
                      <span className="absolute -left-1 -top-5 flex items-center gap-1">
                        <span
                          data-handle="move"
                          aria-hidden="true"
                          className="grid h-5 w-5 cursor-move place-items-center rounded-full bg-emerald-600 text-white shadow-md"
                        >
                          <GripHorizontal className="h-3 w-3" />
                        </span>
                        <button
                          type="button"
                          aria-label={t("edDeleteEl")}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            pushUndo();
                            updateEls((els) => els.filter((x) => x.id !== el.id));
                            setSelectedId(null);
                          }}
                          className="grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white shadow-md"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    <div
                      ref={(node) => {
                        textRefs.current[el.id] = node;
                        // Sync state → DOM imperatively (React must never own the
                        // editable's children). Deferred to rAF so it always reads
                        // the state AFTER any blur-commit lands, and never wipes
                        // a box that is (or just was) being edited.
                        if (node && document.activeElement !== node) {
                          requestAnimationFrame(() => {
                            const cur = (elsRef.current[pageNumRef.current] ?? []).find(
                              (x) => x.id === el.id
                            );
                            const latest = cur && cur.type === "text" ? cur.text : "";
                            if (
                              node &&
                              document.activeElement !== node &&
                              node.innerText !== latest
                            ) {
                              node.innerText = latest;
                            }
                          });
                        }
                      }}
                      contentEditable={selectedId === el.id}
                      suppressContentEditableWarning
                      spellCheck={false}
                      data-ph={t("edEmptyText")}
                      onMouseDown={(e) => {
                        // select tool: text click selects + drags; text tool or selected: edits
                        if (tool !== "select" && selectedId !== el.id) e.stopPropagation();
                      }}
                      onInput={(e) => {
                        // live-commit on every keystroke — blur then only handles
                        // width + empty cleanup, so no text is ever lost to races
                        const text = e.currentTarget.innerText.replace(/\u00a0/g, " ");
                        updateEls((els) =>
                          els.map((x) =>
                            x.id === el.id && x.type === "text" ? { ...x, text } : x
                          )
                        );
                      }}
                      onBlur={(e) => {
                        const text = e.currentTarget.innerText.replace(/\u00a0/g, " ");
                        const w = Math.max(
                          24,
                          e.currentTarget.scrollWidth / fitScale + 4
                        );
                        if (!text.trim()) {
                          // emptied a native box = delete the ORIGINAL text entirely
                          deleteElement(pageNum, el.id);
                          setSelectedId((cur) => (cur === el.id ? null : cur));
                        } else {
                          updateEls((els) =>
                            els.map((x) =>
                              x.id === el.id && x.type === "text" ? { ...x, text, w } : x
                            )
                          );
                          // re-render the page with the original operators gone
                          schedulePreview();
                        }
                      }}
                      className={`fm-ed-text whitespace-pre-wrap break-words outline-none ${
                        selectedId === el.id
                          ? "ring-1 ring-rose-400/70"
                          : "cursor-text hover:ring-1 hover:ring-rose-300/60"
                      }`}
                      style={{
                        fontSize: el.size * fitScale,
                        lineHeight: 1.35,
                        color: el.color,
                        fontWeight: el.bold ? 600 : 400,
                        maxWidth: (disp.w - el.x) * fitScale,
                      }}
                    />
                  </div>
                ) : null
              )}
            </div>
          </div>

          {/* selected hint for image resize */}
          {previewBusy && (
            <div className="pointer-events-none fixed bottom-24 right-4 z-40 flex items-center gap-1.5 rounded-full border border-emerald-900/10 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 shadow-lg">
              <Loader2 className="h-3 w-3 animate-spin" />
              {lang === "en" ? "Updating preview…" : "প্রিভিউ আপডেট হচ্ছে…"}
            </div>
          )}
          {selected && selected.type === "image" && (
            <p className="mt-3 text-center text-[11px] font-medium text-emerald-900/50">
              {lang === "en"
                ? "Drag to move · corner dot to resize · × to delete"
                : "টেনে সরান · কোণার বিন্দু দিয়ে সাইজ বদলান · × দিয়ে মুছুন"}
            </p>
          )}
        </div>
      </div>

      {/* ── signature pad dialog ───────────────────────────────────── */}
      <Dialog open={sigOpen} onOpenChange={setSigOpen}>
        <DialogContent className="fm-card max-w-md rounded-3xl border-emerald-900/10">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-emerald-950">
              {t("edSigTitle")}
            </DialogTitle>
          </DialogHeader>
          <SignaturePad
            onInsert={(url) => {
              setSigOpen(false);
              addImageEl(url);
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
