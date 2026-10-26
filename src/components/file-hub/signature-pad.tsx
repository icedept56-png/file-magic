"use client";

import { useCallback, useRef, useState } from "react";
import { Eraser, ImagePlus, PenLine, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";

type Mode = "draw" | "type" | "image";

/** signature ink choices — real-pen colors, not UI theme colors */
const INKS = [
  { c: "#111827", key: "sgInkBlack" },
  { c: "#1e3a8a", key: "sgInkBlue" },
  { c: "#991b1b", key: "sgInkRed" },
] as const;

/**
 * সিগনেচার প্যাড ২.০ (Day 19): draw / type / upload-image — all three emit a
 * transparent PNG data URL through the same onInsert contract the PDF editor
 * already consumes.
 */
export function SignaturePad({ onInsert }: { onInsert: (dataUrl: string) => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>("draw");
  const [ink, setInk] = useState<string>(INKS[0].c);
  const [busy, setBusy] = useState(false);

  /* ── draw ── */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current?.x ?? p.x, last.current?.y ?? p.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  };
  const end = () => {
    drawing.current = false;
    last.current = null;
  };
  const clearDraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }, []);

  /* ── type ── */
  const [sigText, setSigText] = useState("");
  const [fontIdx, setFontIdx] = useState(0);
  const typeCanvasRef = useRef<HTMLCanvasElement>(null);

  const redrawType = useCallback(
    (text: string, fi: number, color: string) => {
      const c = typeCanvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      if (!text.trim()) return;
      // resolve the CSS variable families into a concrete font string
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.fontFamily =
        fi === 0
          ? "var(--font-sign), var(--font-bengali), cursive"
          : fi === 1
            ? "var(--font-bengali), 'Hind Siliguri', sans-serif"
            : "Georgia, 'Times New Roman', serif";
      document.body.appendChild(probe);
      const fam = getComputedStyle(probe).fontFamily;
      probe.remove();
      ctx.save();
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(fi === 1 ? -0.05 : -0.035);
      ctx.font = fi === 2 ? `italic 64px ${fam}` : `600 72px ${fam}`;
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    },
    []
  );

  /* ── image ── */
  const imgCanvasRef = useRef<HTMLCanvasElement>(null);
  const [imgReady, setImgReady] = useState(false);

  const loadImage = async (file: File) => {
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const c = imgCanvasRef.current;
      if (!c) return;
      const maxW = 680;
      const maxH = 260;
      const scale = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      // whiteness → transparency: light paper becomes see-through, ink stays
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum > 232) {
          d[i + 3] = 0;
        } else if (lum > 180) {
          d[i + 3] = Math.round(d[i + 3] * ((232 - lum) / 52));
        }
      }
      ctx.putImageData(id, 0, 0);
      setImgReady(true);
    } catch {
      /* bad image — ignore, user can retry */
    } finally {
      setBusy(false);
    }
  };

  const TABS: { id: Mode; icon: typeof PenLine; key: "sgTabDraw" | "sgTabType" | "sgTabImage" }[] = [
    { id: "draw", icon: PenLine, key: "sgTabDraw" },
    { id: "type", icon: Type, key: "sgTabType" },
    { id: "image", icon: ImagePlus, key: "sgTabImage" },
  ];

  const canInsert =
    mode === "draw" ? hasInk : mode === "type" ? sigText.trim().length > 0 : imgReady;

  const insert = () => {
    if (mode === "draw") {
      const c = canvasRef.current;
      if (!c || !hasInk) return;
      onInsert(c.toDataURL("image/png"));
    } else if (mode === "type") {
      const c = typeCanvasRef.current;
      if (!c || !sigText.trim()) return;
      onInsert(c.toDataURL("image/png"));
    } else {
      const c = imgCanvasRef.current;
      if (!c || !imgReady) return;
      onInsert(c.toDataURL("image/png"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* mode tabs */}
      <div className="flex items-center gap-1 rounded-xl bg-emerald-50 p-1" role="radiogroup" aria-label={t("sgModeAria")}>
        {TABS.map(({ id, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === id ? "bg-white text-emerald-700 shadow-sm" : "text-emerald-900/60 hover:text-emerald-800"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {t(key)}
          </button>
        ))}
      </div>

      {/* ink swatches */}
      <div className="flex items-center gap-2" role="radiogroup" aria-label={t("sgInk")}>
        <span className="text-xs font-medium text-emerald-900/60">{t("sgInk")}</span>
        {INKS.map(({ c, key }) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={ink === c}
            aria-label={t(key)}
            onClick={() => {
              setInk(c);
              if (mode === "type") redrawType(sigText, fontIdx, c);
            }}
            className={`h-7 w-7 rounded-full border-2 transition-all ${
              ink === c ? "scale-110 border-emerald-600 shadow-md" : "border-emerald-900/10"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* canvases */}
      {mode === "draw" && (
        <>
          <div className="overflow-hidden rounded-2xl border-2 border-dashed border-emerald-600/20 bg-white">
            <canvas
              ref={canvasRef}
              width={680}
              height={280}
              className="block h-40 w-full touch-none sm:h-48"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              aria-label={t("edSigTitle")}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={clearDraw}
              className="gap-1.5 rounded-xl border-emerald-900/10 text-emerald-900/70 hover:bg-emerald-50"
            >
              <Eraser className="h-3.5 w-3.5" />
              {t("edSigClear")}
            </Button>
            <Button
              size="sm"
              onClick={insert}
              disabled={!canInsert}
              className="btn-shine gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 hover:brightness-105 disabled:opacity-50"
            >
              <PenLine className="h-3.5 w-3.5" />
              {t("edSigInsert")}
            </Button>
          </div>
        </>
      )}

      {mode === "type" && (
        <>
          <div className="overflow-hidden rounded-2xl border-2 border-dashed border-emerald-600/20 bg-white">
            <canvas ref={typeCanvasRef} width={680} height={220} className="block h-32 w-full sm:h-36" aria-label={t("sgTypeAria")} />
          </div>
          <Input
            value={sigText}
            onChange={(e) => {
              setSigText(e.target.value);
              redrawType(e.target.value, fontIdx, ink);
            }}
            placeholder={t("sgTypePh")}
            aria-label={t("sgTypeAria")}
            className="h-11 border-emerald-900/10 focus-visible:ring-emerald-500/50"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1" role="radiogroup" aria-label={t("sgFont")}>
              {(["sgFontHand", "sgFontBn", "sgFontFormal"] as const).map((k, i) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={fontIdx === i}
                  onClick={() => {
                    setFontIdx(i);
                    redrawType(sigText, i, ink);
                  }}
                  className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold transition-all ${
                    fontIdx === i
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-emerald-900/10 text-emerald-900/60 hover:border-emerald-500/40"
                  }`}
                >
                  {t(k)}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              onClick={insert}
              disabled={!canInsert}
              className="btn-shine gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 hover:brightness-105 disabled:opacity-50"
            >
              <PenLine className="h-3.5 w-3.5" />
              {t("edSigInsert")}
            </Button>
          </div>
        </>
      )}

      {mode === "image" && (
        <>
          <div className="overflow-hidden rounded-2xl border-2 border-dashed border-emerald-600/20 bg-white">
            {imgReady ? (
              <canvas ref={imgCanvasRef} className="mx-auto block h-40 w-auto max-w-full sm:h-44" aria-label={t("sgImgAria")} />
            ) : (
              <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 text-center sm:h-44">
                <ImagePlus className="h-8 w-8 text-emerald-500" aria-hidden="true" />
                <span className="text-sm font-medium text-emerald-900/70">{t("sgImgPick")}</span>
                <span className="text-xs text-emerald-900/45">{t("sgImgHint")}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label={t("sgImgAria")}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadImage(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            {imgReady ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImgReady(false)}
                className="gap-1.5 rounded-xl border-emerald-900/10 text-emerald-900/70 hover:bg-emerald-50"
              >
                <Eraser className="h-3.5 w-3.5" />
                {t("sgImgAnother")}
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              onClick={insert}
              disabled={!canInsert}
              className="btn-shine gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 hover:brightness-105 disabled:opacity-50"
            >
              <PenLine className="h-3.5 w-3.5" />
              {t("edSigInsert")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
