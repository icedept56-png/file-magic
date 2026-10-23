"use client";

/* ═══════════════════════════════════════════════════════════════════════
   Image Editor — full-screen canvas studio
   3-layer architecture:
     baseCanvasRef   offscreen  — current base bitmap (rotate/flip/crop applied, NO filters)
     paintCanvasRef  offscreen  — freehand pen strokes only (same dims as base)
     displayCanvas   visible    — redraw(): filter → base → paint → texts
   Destructive ops (rotate/flip/crop) flatten paint+texts into base first,
   then transform, so nothing skews. Undo = full snapshot stack (max 30).
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bold,
  Crop,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  Pencil,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Type,
  Undo2,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useT, type StrKey } from "@/lib/i18n";
import { downloadBlob, stripExt } from "@/lib/tools/helpers";
import { useAppStore } from "@/store/app-store";

/* ── types ─────────────────────────────────────────────────────────────── */

type ToolId = "crop" | "filter" | "draw" | "text";
type Fmt = "png" | "jpeg" | "webp";
type Pt = { x: number; y: number };

type Filter = {
  brightness: number;
  contrast: number;
  saturate: number;
  blur: number;
  grayscale: number;
  sepia: number;
  hue: number;
  invert: number;
};

type TextEl = { id: string; x: number; y: number; text: string; size: number; color: string; bold: boolean };
type CropRect = { x: number; y: number; w: number; h: number };
type CropMode = "move" | "nw" | "ne" | "sw" | "se";

type Snapshot = { base: HTMLCanvasElement; paint: HTMLCanvasElement; texts: TextEl[]; filter: Filter };

type Drag =
  | { kind: "stroke"; last: Pt; mid: Pt }
  | { kind: "text"; id: string; sx: number; sy: number; ox: number; oy: number }
  | { kind: "crop"; mode: CropMode; sx: number; sy: number; rect: CropRect };

/* ── constants ─────────────────────────────────────────────────────────── */

const ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp";
const MAX_UNDO = 30;
const MIN_CROP = 20; // display px
const DEFAULT_FILTER: Filter = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  hue: 0,
  invert: 0,
};

const FILTER_SLIDERS: { key: keyof Filter; label: StrKey; min: number; max: number; step: number }[] = [
  { key: "brightness", label: "ieBright", min: 0, max: 200, step: 1 },
  { key: "contrast", label: "ieContrast", min: 0, max: 200, step: 1 },
  { key: "saturate", label: "ieSat", min: 0, max: 200, step: 1 },
  { key: "blur", label: "ieBlur", min: 0, max: 20, step: 0.5 },
  { key: "grayscale", label: "ieGray", min: 0, max: 100, step: 1 },
  { key: "sepia", label: "ieSepia", min: 0, max: 100, step: 1 },
  { key: "hue", label: "ieHue", min: 0, max: 360, step: 1 },
  { key: "invert", label: "ieInvert", min: 0, max: 100, step: 1 },
];

const PRESETS: { key: StrKey; f: Partial<Filter> }[] = [
  { key: "iePresetOriginal", f: DEFAULT_FILTER },
  { key: "iePresetVivid", f: { saturate: 140, contrast: 115 } },
  { key: "iePresetMono", f: { grayscale: 100 } },
  { key: "iePresetWarm", f: { sepia: 45, saturate: 115, brightness: 105 } },
  { key: "iePresetCool", f: { hue: 15, saturate: 110, brightness: 105, contrast: 108 } },
  { key: "iePresetVintage", f: { sepia: 30, contrast: 90, saturate: 80, brightness: 105 } },
];

const CROP_HANDLES: { m: CropMode; cls: string }[] = [
  { m: "nw", cls: "-left-2 -top-2 cursor-nwse-resize" },
  { m: "ne", cls: "-right-2 -top-2 cursor-nesw-resize" },
  { m: "sw", cls: "-bottom-2 -left-2 cursor-nesw-resize" },
  { m: "se", cls: "-bottom-2 -right-2 cursor-nwse-resize" },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const mkCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
};
const cloneCanvas = (src: HTMLCanvasElement) => {
  const c = mkCanvas(src.width, src.height);
  c.getContext("2d")?.drawImage(src, 0, 0);
  return c;
};
const fontFor = (el: TextEl) => `${el.bold ? "bold " : ""}${el.size}px sans-serif`;

/** CSS filter string — only non-default values (canvas ctx.filter compatible) */
function filterCSS(f: Filter): string {
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia > 0) parts.push(`sepia(${f.sepia}%)`);
  if (f.hue !== 0) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.invert > 0) parts.push(`invert(${f.invert}%)`);
  return parts.length ? parts.join(" ") : "none";
}

/* ═══════════════════════════════════════════════════════════════════════ */

export function ImageEditor() {
  const { t, num, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);

  /* document state */
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 }); // base bitmap size (canvas px)
  const [view, setView] = useState({ w: 0, h: 0 }); // displayed css size of canvas

  /* canvases */
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLDivElement | null>(null);

  /* edits */
  const [texts, setTexts] = useState<TextEl[]>([]);
  const [filt, setFilt] = useState<Filter>(DEFAULT_FILTER);
  const textsRef = useRef<TextEl[]>([]);
  const filtRef = useRef<Filter>(DEFAULT_FILTER);
  const undoRef = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  /* ui */
  const [tool, setTool] = useState<ToolId | null>(null);
  const [saving, setSaving] = useState(false);
  const [fmt, setFmt] = useState<Fmt>("png");
  const [quality, setQuality] = useState(92);
  const [drawColor, setDrawColor] = useState("#e11d48");
  const [brush, setBrush] = useState(4);
  const [textColor, setTextColor] = useState("#111111");
  const [textSize, setTextSize] = useState(28);
  const [textBold, setTextBold] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const prevToolRef = useRef<ToolId | null>(null);
  const rafRef = useRef(0);

  /* ═══════════════════════ rendering ═══════════════════════ */

  const drawNow = useCallback(() => {
    const base = baseCanvasRef.current;
    const paint = paintCanvasRef.current;
    const disp = displayCanvasRef.current;
    if (!base || !paint || !disp) return;
    if (disp.width !== base.width || disp.height !== base.height) {
      disp.width = base.width;
      disp.height = base.height;
    }
    const ctx = disp.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, disp.width, disp.height);
    const f = filterCSS(filtRef.current);
    if (f !== "none") ctx.filter = f;
    ctx.drawImage(base, 0, 0);
    ctx.filter = "none";
    ctx.drawImage(paint, 0, 0);
    for (const el of textsRef.current) {
      ctx.font = fontFor(el);
      ctx.fillStyle = el.color;
      ctx.fillText(el.text, el.x, el.y);
    }
    setDims((d) => (d.w === base.width && d.h === base.height ? d : { w: base.width, h: base.height }));
  }, []);

  /** coalesced redraw — safe to call from any handler */
  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawNow();
    });
  }, [drawNow]);
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  /* redraw on demand: new image / filter change / text change */
  useEffect(() => {
    scheduleRedraw();
  }, [name, filt, texts, scheduleRedraw]);

  /* track displayed css size (drives overlay + crop coordinate mapping) */
  useEffect(() => {
    const c = displayCanvasRef.current;
    if (!c || !name) return;
    const update = () => {
      const r = c.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      setView((v) =>
        Math.abs(v.w - r.width) < 0.5 && Math.abs(v.h - r.height) < 0.5 ? v : { w: r.width, h: r.height }
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [name]);

  /* ═══════════════════════ state helpers (ref-synced) ═══════════════════ */

  const commitTexts = (next: TextEl[]) => {
    textsRef.current = next;
    setTexts(next);
  };
  const applyFilter = (f: Filter) => {
    filtRef.current = f;
    setFilt(f);
  };

  /* ═══════════════════════ undo ═══════════════════════ */

  const pushUndo = useCallback(() => {
    const base = baseCanvasRef.current;
    if (!base) return;
    undoRef.current.push({
      base: cloneCanvas(base),
      paint: paintCanvasRef.current ? cloneCanvas(paintCanvasRef.current) : mkCanvas(1, 1),
      texts: textsRef.current.map((x) => ({ ...x })),
      filter: { ...filtRef.current },
    });
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    /* an open text session dies with the restore */
    if (editingIdRef.current) {
      editingIdRef.current = null;
      setEditingId(null);
    }
    baseCanvasRef.current = snap.base;
    paintCanvasRef.current = snap.paint;
    textsRef.current = snap.texts;
    setTexts(snap.texts);
    filtRef.current = snap.filter;
    setFilt(snap.filter);
    setCanUndo(undoRef.current.length > 0);
    scheduleRedraw();
  }, [scheduleRedraw]);

  /* ═══════════════════════ load ═══════════════════════ */

  const openFile = async (file: File) => {
    setLoading(true);
    try {
      const bmp = await createImageBitmap(file);
      const base = mkCanvas(bmp.width, bmp.height);
      base.getContext("2d")?.drawImage(bmp, 0, 0);
      const w = bmp.width;
      const h = bmp.height;
      bmp.close();
      baseCanvasRef.current = base;
      paintCanvasRef.current = mkCanvas(w, h);
      undoRef.current = [];
      setCanUndo(false);
      commitTexts([]);
      applyFilter({ ...DEFAULT_FILTER });
      setTool(null);
      setCrop(null);
      editingIdRef.current = null;
      setEditingId(null);
      setFmt("png");
      setQuality(92);
      setName(file.name);
      /* redraw happens via the [name] effect once the canvas mounts */
    } catch {
      toast.error(t("ieLoadFail"));
    } finally {
      setLoading(false);
    }
  };

  /* ═══════════════════════ flatten + transforms ═══════════════════════ */

  /** composite pen strokes + texts onto base (base-coords), clear layers */
  const flattenOntoBase = () => {
    const base = baseCanvasRef.current;
    const paint = paintCanvasRef.current;
    if (!base || !paint) return;
    const ctx = base.getContext("2d");
    if (ctx) {
      ctx.drawImage(paint, 0, 0);
      for (const el of textsRef.current) {
        ctx.font = fontFor(el);
        ctx.fillStyle = el.color;
        ctx.fillText(el.text, el.x, el.y);
      }
    }
    paint.getContext("2d")?.clearRect(0, 0, paint.width, paint.height);
    commitTexts([]);
    if (editingIdRef.current) {
      editingIdRef.current = null;
      setEditingId(null);
    }
  };

  const rotate = (dir: 1 | -1) => {
    const base = baseCanvasRef.current;
    if (!base) return;
    pushUndo();
    flattenOntoBase();
    const out = mkCanvas(base.height, base.width);
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    baseCanvasRef.current = out;
    paintCanvasRef.current = mkCanvas(out.width, out.height);
    scheduleRedraw();
  };

  const flip = (horizontal: boolean) => {
    const base = baseCanvasRef.current;
    if (!base) return;
    pushUndo();
    flattenOntoBase();
    const out = mkCanvas(base.width, base.height);
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.translate(horizontal ? base.width : 0, horizontal ? 0 : base.height);
    ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    ctx.drawImage(base, 0, 0);
    baseCanvasRef.current = out;
    paintCanvasRef.current = mkCanvas(out.width, out.height);
    scheduleRedraw();
  };

  /* ═══════════════════════ crop ═══════════════════════ */

  /* init / re-init crop rect whenever the tool turns on or size changes */
  useEffect(() => {
    if (tool !== "crop") return;
    const c = displayCanvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    setCrop({ x: r.width * 0.1, y: r.height * 0.1, w: r.width * 0.8, h: r.height * 0.8 });
  }, [tool, dims.w, dims.h]);

  const applyCropDrag = (d: Drag & { kind: "crop" }, e: React.PointerEvent<HTMLDivElement>) => {
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const W = view.w;
    const H = view.h;
    if (d.mode === "move") {
      setCrop({
        x: clamp(d.rect.x + dx, 0, Math.max(0, W - d.rect.w)),
        y: clamp(d.rect.y + dy, 0, Math.max(0, H - d.rect.h)),
        w: d.rect.w,
        h: d.rect.h,
      });
      return;
    }
    let { x, y, w, h } = d.rect;
    if (d.mode.includes("n")) {
      y = clamp(d.rect.y + dy, 0, d.rect.y + d.rect.h - MIN_CROP);
      h = d.rect.y + d.rect.h - y;
    }
    if (d.mode.includes("s")) h = clamp(d.rect.h + dy, MIN_CROP, Math.max(MIN_CROP, H - d.rect.y));
    if (d.mode.includes("w")) {
      x = clamp(d.rect.x + dx, 0, d.rect.x + d.rect.w - MIN_CROP);
      w = d.rect.x + d.rect.w - x;
    }
    if (d.mode.includes("e")) w = clamp(d.rect.w + dx, MIN_CROP, Math.max(MIN_CROP, W - d.rect.x));
    setCrop({ x, y, w, h });
  };

  const cropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!crop) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (px < crop.x || px > crop.x + crop.w || py < crop.y || py > crop.y + crop.h) return;
    dragRef.current = { kind: "crop", mode: "move", sx: e.clientX, sy: e.clientY, rect: crop };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const cropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.kind !== "crop") return;
    applyCropDrag(d, e);
  };

  const cropPointerUp = () => {
    dragRef.current = null;
  };

  const startCropHandle = (mode: CropMode) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!crop) return;
    e.stopPropagation();
    dragRef.current = { kind: "crop", mode, sx: e.clientX, sy: e.clientY, rect: crop };
    overlayRef.current?.setPointerCapture(e.pointerId);
  };

  const applyCrop = () => {
    const disp = displayCanvasRef.current;
    if (!disp || !crop) return;
    const base = baseCanvasRef.current;
    if (!base) return;
    const r = disp.getBoundingClientRect();
    const sx = Math.round((crop.x / r.width) * base.width);
    const sy = Math.round((crop.y / r.height) * base.height);
    const sw = Math.max(1, Math.round((crop.w / r.width) * base.width));
    const sh = Math.max(1, Math.round((crop.h / r.height) * base.height));
    pushUndo();
    flattenOntoBase();
    const b2 = baseCanvasRef.current;
    if (!b2) return;
    const out = mkCanvas(sw, sh);
    out.getContext("2d")?.drawImage(b2, sx, sy, sw, sh, 0, 0, sw, sh);
    baseCanvasRef.current = out;
    paintCanvasRef.current = mkCanvas(sw, sh);
    setCrop(null);
    setTool(null);
    scheduleRedraw();
  };

  const cancelCrop = () => {
    setCrop(null);
    setTool(null);
  };

  /* ═══════════════════════ draw (pen) ═══════════════════════ */

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const startStroke = (pos: Pt, e: React.PointerEvent<HTMLCanvasElement>) => {
    const paint = paintCanvasRef.current;
    const ctx = paint?.getContext("2d");
    if (!ctx) return;
    pushUndo();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brush;
    ctx.strokeStyle = drawColor;
    ctx.fillStyle = drawColor;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    dragRef.current = { kind: "stroke", last: pos, mid: pos };
    e.currentTarget.setPointerCapture(e.pointerId);
    scheduleRedraw();
  };

  /* ═══════════════════════ text ═══════════════════════ */

  const finalizeEditing = useCallback(() => {
    const id = editingIdRef.current;
    if (!id) return;
    editingIdRef.current = null;
    setEditingId(null);
    const node = editRef.current;
    /* freshest source wins: live DOM text, else the last onInput commit */
    const text = (node ? node.innerText : textsRef.current.find((x) => x.id === id)?.text ?? "").replace(
      /\u00a0/g,
      " "
    );
    const exists = textsRef.current.some((x) => x.id === id);
    if (!exists) return;
    if (!text.trim()) {
      /* never rendered any content — drop the placeholder silently */
      commitTexts(textsRef.current.filter((x) => x.id !== id));
    } else {
      commitTexts(textsRef.current.map((x) => (x.id === id ? { ...x, text } : x)));
    }
  }, []);

  /* leaving the text tool finalizes the open session */
  useEffect(() => {
    if (prevToolRef.current === "text" && tool !== "text") finalizeEditing();
    prevToolRef.current = tool;
  }, [tool, finalizeEditing]);

  /* focus a freshly created text box */
  useEffect(() => {
    if (!editingId) return;
    const node = editRef.current;
    if (node) node.focus();
  }, [editingId]);

  const hitTestText = (pos: Pt): TextEl | null => {
    const ctx = displayCanvasRef.current?.getContext("2d");
    if (!ctx) return null;
    for (let i = textsRef.current.length - 1; i >= 0; i--) {
      const el = textsRef.current[i];
      ctx.font = fontFor(el);
      const m = ctx.measureText(el.text || " ");
      const asc = m.actualBoundingBoxAscent || el.size * 0.8;
      const desc = m.actualBoundingBoxDescent || el.size * 0.25;
      if (
        pos.x >= el.x - 6 &&
        pos.x <= el.x + m.width + 6 &&
        pos.y >= el.y - asc - 6 &&
        pos.y <= el.y + desc + 6
      ) {
        return el;
      }
    }
    return null;
  };

  const createText = (pos: Pt) => {
    pushUndo();
    const el: TextEl = {
      id: uid(),
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      text: "",
      size: textSize,
      color: textColor,
      bold: textBold,
    };
    commitTexts([...textsRef.current, el]);
    editingIdRef.current = el.id;
    setEditingId(el.id);
  };

  const updateEditing = (patch: Partial<TextEl>) => {
    const id = editingIdRef.current;
    if (!id) return;
    commitTexts(textsRef.current.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  /* ═══════════════════════ canvas pointer events ═══════════════════════ */

  const canvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!name) return;
    const pos = toCanvas(e);
    if (tool === "draw") {
      startStroke(pos, e);
      return;
    }
    if (tool === "text") {
      finalizeEditing();
      const hit = hitTestText(pos);
      if (hit) {
        pushUndo();
        dragRef.current = { kind: "text", id: hit.id, sx: pos.x, sy: pos.y, ox: hit.x, oy: hit.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        createText(pos);
      }
    }
  };

  const canvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const pos = toCanvas(e);
    if (d.kind === "stroke") {
      const ctx = paintCanvasRef.current?.getContext("2d");
      if (!ctx) return;
      const mid = { x: (d.last.x + pos.x) / 2, y: (d.last.y + pos.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(d.mid.x, d.mid.y);
      ctx.quadraticCurveTo(d.last.x, d.last.y, mid.x, mid.y);
      ctx.stroke();
      d.last = pos;
      d.mid = mid;
      scheduleRedraw();
      return;
    }
    if (d.kind === "text") {
      const base = baseCanvasRef.current;
      if (!base) return;
      const nx = clamp(d.ox + (pos.x - d.sx), 0, base.width);
      const ny = clamp(d.oy + (pos.y - d.sy), 0, base.height);
      commitTexts(
        textsRef.current.map((x) => (x.id === d.id ? { ...x, x: Math.round(nx), y: Math.round(ny) } : x))
      );
    }
  };

  const canvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (d && d.kind === "stroke") {
      /* finish the tail of the stroke */
      const ctx = paintCanvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = brush;
        ctx.strokeStyle = drawColor;
        ctx.beginPath();
        ctx.moveTo(d.mid.x, d.mid.y);
        ctx.lineTo(d.last.x, d.last.y);
        ctx.stroke();
      }
      scheduleRedraw();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  /* ═══════════════════════ export ═══════════════════════ */

  const save = async () => {
    const disp = displayCanvasRef.current;
    if (!disp || !name) return;
    setSaving(true);
    try {
      let out: HTMLCanvasElement = disp;
      if (fmt === "jpeg") {
        /* jpeg has no alpha — flatten onto white first */
        const flat = mkCanvas(disp.width, disp.height);
        const fctx = flat.getContext("2d");
        if (!fctx) throw new Error("2d context unavailable");
        fctx.fillStyle = "#ffffff";
        fctx.fillRect(0, 0, flat.width, flat.height);
        fctx.drawImage(disp, 0, 0);
        out = flat;
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, `image/${fmt}`, quality / 100)
      );
      if (!blob) throw new Error("toBlob failed");
      downloadBlob(blob, `${stripExt(name)}-edited.${fmt === "jpeg" ? "jpg" : fmt}`);
      toast.success(t("ieSaved"));
    } catch {
      toast.error(t("ieSaveFail"));
    } finally {
      setSaving(false);
    }
  };

  /* ═══════════════════════ toolbar data ═══════════════════════ */

  const TOOLS: { id: ToolId; icon: LucideIcon; label: string }[] = [
    { id: "crop", icon: Crop, label: t("ieToolCrop") },
    { id: "filter", icon: SlidersHorizontal, label: t("ieToolFilter") },
    { id: "draw", icon: Pencil, label: t("ieToolDraw") },
    { id: "text", icon: Type, label: t("ieToolText") },
  ];

  const QUICK: { icon: LucideIcon; label: string; on: () => void; disabled?: boolean }[] = [
    { icon: RotateCcw, label: t("ieRotateL"), on: () => rotate(-1) },
    { icon: RotateCw, label: t("ieRotateR"), on: () => rotate(1) },
    { icon: FlipHorizontal2, label: t("ieFlipH"), on: () => flip(true) },
    { icon: FlipVertical2, label: t("ieFlipV"), on: () => flip(false) },
    { icon: Undo2, label: t("ieUndo"), on: undo, disabled: !canUndo },
  ];

  const editingEl = editingId ? texts.find((x) => x.id === editingId) : null;
  const scale = view.w > 0 && dims.w > 0 ? view.w / dims.w : 1;
  const cropScaleX = view.w > 0 && dims.w > 0 ? dims.w / view.w : 1;

  /* ═══════════════════════ empty state (dropzone) ═══════════════════════ */

  if (!name) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:px-6" aria-label={t("ieEditorAria")}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="fm-card rounded-3xl p-8 text-center sm:p-12"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void openFile(f);
          }}
        >
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 shadow-lg shadow-fuchsia-500/30">
            <UploadCloud className="h-8 w-8 text-white" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-emerald-950 sm:text-2xl">{t("ieTitle")}</h1>
          <p className="mt-2 text-sm text-emerald-900/60">{t("ieDropHint")}</p>

          <div
            role="button"
            tabIndex={0}
            aria-label={t("iePick")}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            className={`mt-8 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 outline-none transition focus-visible:ring-2 focus-visible:ring-fuchsia-500/50 ${
              dragOver
                ? "border-fuchsia-500/60 bg-fuchsia-50/70"
                : "border-fuchsia-500/25 bg-fuchsia-50/40 hover:border-fuchsia-500/50 hover:bg-fuchsia-50/70"
            }`}
          >
            <p className="font-semibold text-emerald-950/85">{t("ieDrop")}</p>
            <Button
              className="btn-shine mt-4 bg-gradient-to-r from-fuchsia-500 to-rose-500 shadow-lg shadow-fuchsia-500/25 hover:from-fuchsia-600 hover:to-rose-600"
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("iePick")}
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-emerald-900/50">
            {TOOLS.map((tool2) => (
              <span
                key={tool2.id}
                className="rounded-full border border-emerald-600/10 bg-emerald-50/70 px-3 py-1 font-medium"
              >
                {tool2.label}
              </span>
            ))}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = "";
            }}
          />
        </motion.div>
      </section>
    );
  }

  /* ═══════════════════════ editor ═══════════════════════ */

  return (
    <section className="flex min-h-[calc(100vh-4rem)] flex-col" aria-label={t("ieEditorAria")}>
      {/* ── header: back · filename · quick transform buttons ─────────── */}
      <div className="sticky top-16 z-30 border-b border-emerald-900/[0.06] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={goHome}
            className="h-9 text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
            aria-label={lang === "en" ? "Back" : "ফিরে যান"}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{lang === "en" ? "Back" : "ফিরে যান"}</span>
          </Button>

          <span className="hidden min-w-0 max-w-[200px] truncate text-sm font-semibold text-emerald-950 md:block">
            {name}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={q.on}
                disabled={q.disabled}
                aria-label={q.label}
                title={q.label}
                className="rounded-xl border border-emerald-900/[0.07] bg-white p-2 text-emerald-900/70 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-30"
              >
                <q.icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── tool chips row ────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-7xl px-3 pt-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {TOOLS.map((tool2) => (
            <button
              key={tool2.id}
              type="button"
              onClick={() => setTool((cur) => (cur === tool2.id ? null : tool2.id))}
              aria-pressed={tool === tool2.id}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                tool === tool2.id
                  ? "border-transparent bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25"
                  : "border-emerald-900/10 bg-white text-emerald-900/70 shadow-sm hover:bg-emerald-50 hover:text-emerald-900"
              }`}
            >
              <tool2.icon className="h-3.5 w-3.5" />
              {tool2.label}
            </button>
          ))}
          {dims.w > 0 && (
            <span className="ml-auto hidden rounded-full bg-emerald-600/[0.07] px-3 py-1 text-[11px] font-bold tabular-nums text-emerald-800 sm:block">
              {num(dims.w)} × {num(dims.h)} px
            </span>
          )}
        </div>
      </div>

      {/* ── main: canvas stage + side panel (panel stacks below on mobile) ── */}
      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* canvas stage */}
        <div className="flex items-center justify-center">
          <div
            className="relative inline-block max-w-full overflow-hidden rounded-xl align-middle"
            style={{
              backgroundImage:
                "conic-gradient(rgba(13,31,22,0.08) 25%, transparent 0 50%, rgba(13,31,22,0.08) 0 75%, transparent 0)",
              backgroundSize: "18px 18px",
            }}
          >
            <canvas
              ref={displayCanvasRef}
              role="img"
              aria-label={t("ieEditorAria")}
              className="block h-auto max-h-[70vh] w-auto max-w-full touch-none select-none"
              style={{ touchAction: "none" }}
              onPointerDown={canvasPointerDown}
              onPointerMove={canvasPointerMove}
              onPointerUp={canvasPointerUp}
              onPointerCancel={canvasPointerUp}
            />

            {/* text overlay — only the box being edited is interactive */}
            <div className="pointer-events-none absolute inset-0 z-10">
              {editingEl && (
                <div
                  ref={editRef}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  role="textbox"
                  aria-label={t("ieEmptyText")}
                  data-ph={t("ieEmptyText")}
                  className="fm-ed-text pointer-events-auto absolute rounded-md bg-white/95 px-1.5 py-0.5 whitespace-pre break-words shadow-md outline-none ring-1 ring-emerald-600/30"
                  style={{
                    left: editingEl.x * scale,
                    top: Math.max(0, (editingEl.y - editingEl.size * 1.05) * scale),
                    fontSize: editingEl.size * scale,
                    lineHeight: 1.2,
                    color: editingEl.color,
                    fontWeight: editingEl.bold ? 700 : 400,
                    maxWidth: Math.max(48, (dims.w - editingEl.x) * scale),
                  }}
                  onInput={(e) => {
                    const text = e.currentTarget.innerText.replace(/\u00a0/g, " ");
                    const id = editingIdRef.current;
                    if (!id) return;
                    commitTexts(textsRef.current.map((x) => (x.id === id ? { ...x, text } : x)));
                  }}
                  onBlur={() => finalizeEditing()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" || e.key === "Enter") {
                      e.preventDefault();
                      finalizeEditing();
                    } else if ((e.key === "Delete" || e.key === "Backspace") && !e.currentTarget.innerText.trim()) {
                      e.preventDefault();
                      finalizeEditing();
                    }
                  }}
                />
              )}
            </div>

            {/* crop overlay */}
            {tool === "crop" && crop && (
              <div
                ref={overlayRef}
                className="absolute inset-0 z-20 touch-none"
                onPointerDown={cropPointerDown}
                onPointerMove={cropPointerMove}
                onPointerUp={cropPointerUp}
                onPointerCancel={cropPointerUp}
              >
                <div
                  className="absolute border-2 border-emerald-500 shadow-[0_0_0_9999px_rgba(7,7,13,0.45)]"
                  style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                >
                  {CROP_HANDLES.map((h) => (
                    <span
                      key={h.m}
                      data-handle={h.m}
                      onPointerDown={startCropHandle(h.m)}
                      aria-hidden="true"
                      className={`absolute h-4 w-4 rounded-full border-2 border-emerald-600 bg-white shadow ${h.cls}`}
                    />
                  ))}
                  <span className="absolute -top-7 left-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white shadow">
                    {num(Math.max(1, Math.round(crop.w * cropScaleX)))} ×{" "}
                    {num(Math.max(1, Math.round(crop.h * cropScaleX)))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* side panel */}
        <aside className="fm-card h-fit rounded-2xl p-4 lg:sticky lg:top-32">
          {!tool && (
            <div className="space-y-3">
              <h3 className="truncate text-sm font-bold text-emerald-950">{name}</h3>
              {dims.w > 0 && (
                <span className="inline-block rounded-full bg-emerald-600/10 px-2.5 py-1 text-[11px] font-bold tabular-nums text-emerald-800">
                  {num(dims.w)} × {num(dims.h)} px
                </span>
              )}
              <p className="text-xs leading-relaxed text-emerald-900/60">
                {lang === "en"
                  ? "Pick a tool above to crop, filter, draw or add text. Rotate, flip and undo live in the top bar — everything stays on your device."
                  : "উপরের টুল থেকে ক্রপ, ফিল্টার, ড্র বা টেক্সট বেছে নিন। ঘোরানো, ফ্লিপ ও আন্ডু উপরের বারে — সবকিছু আপনার ডিভাইসেই হয়।"}
              </p>
            </div>
          )}

          {tool === "filter" && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-emerald-950">{t("ieToolFilter")}</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyFilter({ ...DEFAULT_FILTER })}
                  className="h-7 rounded-full border-emerald-900/10 px-3 text-xs text-emerald-900/70 hover:bg-emerald-50"
                >
                  {t("ieReset")}
                </Button>
              </div>
              <div className="mt-3 space-y-3">
                {FILTER_SLIDERS.map((s) => (
                  <div key={s.key}>
                    <div className="mb-1 flex items-center justify-between">
                      <Label className="text-xs font-semibold text-emerald-900/70">{t(s.label)}</Label>
                      <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-emerald-800">
                        {num(filt[s.key])}
                      </span>
                    </div>
                    <Slider
                      value={[filt[s.key]]}
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      onValueChange={(v) => applyFilter({ ...filt, [s.key]: v[0] })}
                      aria-label={t(s.label)}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-emerald-900/[0.06] pt-3">
                <p className="text-xs font-bold text-emerald-950">{t("iePreset")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyFilter({ ...DEFAULT_FILTER, ...p.f })}
                      className="rounded-full border border-teal-600/20 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800 transition hover:bg-teal-100"
                    >
                      {t(p.key)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tool === "draw" && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-emerald-950">{t("ieToolDraw")}</h3>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold text-emerald-900/70">{t("ieColor")}</Label>
                <input
                  type="color"
                  value={drawColor}
                  onChange={(e) => setDrawColor(e.target.value)}
                  aria-label={t("ieColor")}
                  className="h-8 w-12 cursor-pointer rounded-lg border border-emerald-900/10 bg-white p-0.5"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-xs font-semibold text-emerald-900/70">{t("ieSize")}</Label>
                  <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-emerald-800">
                    {num(brush)}
                  </span>
                </div>
                <Slider
                  value={[brush]}
                  min={1}
                  max={40}
                  step={1}
                  onValueChange={(v) => setBrush(v[0])}
                  aria-label={t("ieSize")}
                />
              </div>
              <p className="text-xs leading-relaxed text-emerald-900/60">
                {lang === "en"
                  ? "Draw directly on the canvas with your mouse, pen or finger."
                  : "মাউস, পেন বা আঙুল দিয়ে সরাসরি ক্যানভাসে আঁকুন।"}
              </p>
            </div>
          )}

          {tool === "text" && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-emerald-950">{t("ieToolText")}</h3>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold text-emerald-900/70">{t("ieColor")}</Label>
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => {
                    setTextColor(e.target.value);
                    updateEditing({ color: e.target.value });
                  }}
                  aria-label={t("ieColor")}
                  className="h-8 w-12 cursor-pointer rounded-lg border border-emerald-900/10 bg-white p-0.5"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-xs font-semibold text-emerald-900/70">{t("ieTextSize")}</Label>
                  <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-emerald-800">
                    {num(textSize)}
                  </span>
                </div>
                <Slider
                  value={[textSize]}
                  min={12}
                  max={96}
                  step={1}
                  onValueChange={(v) => {
                    setTextSize(v[0]);
                    updateEditing({ size: v[0] });
                  }}
                  aria-label={t("ieTextSize")}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold text-emerald-900/70">
                  {lang === "en" ? "Bold" : "বোল্ড"}
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={textBold}
                  aria-label={lang === "en" ? "Bold" : "বোল্ড"}
                  onClick={() => {
                    setTextBold((b) => !b);
                    updateEditing({ bold: !textBold });
                  }}
                  className={`h-8 w-8 p-0 ${
                    textBold
                      ? "border-transparent bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow"
                      : "border-emerald-900/10 text-emerald-900/70"
                  }`}
                >
                  <Bold className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-emerald-900/60">
                {lang === "en"
                  ? "Click the canvas to add text · drag existing text to move it · Enter or Escape to finish."
                  : "টেক্সট যোগ করতে ক্যানভাসে ক্লিক করুন · সরাতে টেক্সট টেনে ধরুন · শেষ করতে Enter বা Escape।"}
              </p>
            </div>
          )}

          {tool === "crop" && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-emerald-950">{t("ieToolCrop")}</h3>
              <p className="text-xs leading-relaxed text-emerald-900/60">
                {lang === "en"
                  ? "Drag inside the box to move it, pull the corner dots to resize."
                  : "বাক্সের ভেতরে টেনে সরান, কোণার বিন্দু টেনে সাইজ বদলান।"}
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={applyCrop}
                  disabled={!crop}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
                >
                  {t("ieApply")}
                </Button>
                <Button
                  variant="outline"
                  onClick={cancelCrop}
                  className="gap-1 border-emerald-900/10 text-emerald-900/70 hover:bg-emerald-50"
                >
                  <X className="h-4 w-4" />
                  {t("ieCancel")}
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── export bar ────────────────────────────────────────────────── */}
      <div className="sticky bottom-3 z-20 mx-auto mt-auto w-full max-w-7xl px-3 pb-3 sm:px-5">
        <div className="fm-card flex flex-wrap items-center gap-3 rounded-2xl p-3 shadow-xl">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-semibold text-emerald-900/70">{t("ieFormat")}</Label>
            <Select value={fmt} onValueChange={(v) => setFmt(v as Fmt)}>
              <SelectTrigger className="h-9 w-28 rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="jpeg">JPEG</SelectItem>
                <SelectItem value="webp">WebP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {fmt !== "png" && (
            <div className="flex min-w-44 flex-1 items-center gap-2">
              <Label className="whitespace-nowrap text-xs font-semibold text-emerald-900/70">
                {t("ieQuality")}
              </Label>
              <Slider
                value={[quality]}
                min={1}
                max={100}
                step={1}
                onValueChange={(v) => setQuality(v[0])}
                aria-label={t("ieQuality")}
                className="max-w-44"
              />
              <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-emerald-800">
                {num(quality)}
              </span>
            </div>
          )}

          <Button
            onClick={() => void save()}
            disabled={saving}
            className="btn-shine ml-auto bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {saving ? t("ieSaving") : t("ieSave")}
          </Button>
        </div>
      </div>
    </section>
  );
}
