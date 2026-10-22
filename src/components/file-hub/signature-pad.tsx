"use client";

import { useCallback, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/**
 * Draw-to-sign pad. Emits a transparent PNG data URL of the signature.
 */
export function SignaturePad({ onInsert }: { onInsert: (dataUrl: string) => void }) {
  const { t } = useT();
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
    ctx.strokeStyle = "#0f172a";
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

  const clear = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }, []);

  const insert = () => {
    const c = canvasRef.current;
    if (!c || !hasInk) return;
    onInsert(c.toDataURL("image/png"));
  };

  return (
    <div className="flex flex-col gap-3">
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
          onClick={clear}
          className="gap-1.5 rounded-xl border-emerald-900/10 text-emerald-900/70 hover:bg-emerald-50"
        >
          <Eraser className="h-3.5 w-3.5" />
          {t("edSigClear")}
        </Button>
        <Button
          size="sm"
          onClick={insert}
          disabled={!hasInk}
          className="btn-shine gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 hover:brightness-105 disabled:opacity-50"
        >
          <PenLine className="h-3.5 w-3.5" />
          {t("edSigInsert")}
        </Button>
      </div>
    </div>
  );
}
