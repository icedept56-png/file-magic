"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  AudioLines,
  Download,
  Loader2,
  Play,
  Scissors,
  Square,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/lib/i18n";
import { downloadBlob, formatBytes, stripExt } from "@/lib/tools/helpers";
import { useAppStore } from "@/store/app-store";

/* ── constants ─────────────────────────────────────────────────────────── */
const WAVE_H = 160; // css px height of the waveform canvas
const MIN_SEL = 0.05; // minimum selection length (seconds)
const BAR_W = 2; // waveform bar width (css px)
const BAR_GAP = 2; // gap between bars (css px)
const ACCEPT = "audio/*,video/*,.mp3,.wav,.ogg,.m4a,.flac,.mp4,.webm";

type Sel = { start: number; end: number };

type Peaks = { key: string; mins: Float32Array; maxs: Float32Array };

/** effective fade windows for a clip of `dur` seconds (never overlap, never exceed) */
function effFades(fiRaw: number, foRaw: number, dur: number): { fi: number; fo: number } {
  const fi = Math.max(0, Math.min(fiRaw, dur / 2));
  const fo = Math.max(0, Math.min(foRaw, dur - fi));
  return { fi, fo };
}

/**
 * Encode interleaved 16-bit PCM WAV (RIFF/WAVE, little-endian) — byte layout:
 *  0..3 "RIFF" | 4..7 fileSize-8 | 8..11 "WAVE" | 12..15 "fmt " | 16..19 fmtSize=16
 *  20..21 format=1(PCM) | 22..23 channels | 24..27 sampleRate | 28..31 byteRate
 *  32..33 blockAlign | 34..35 bits=16 | 36..39 "data" | 40..43 dataSize | 44.. samples
 */
function encodeWav(channelsData: Float32Array[], sampleRate: number): Blob {
  const numCh = Math.max(1, channelsData.length);
  const numFrames = channelsData[0]?.length ?? 0;
  const blockAlign = numCh * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = channelsData[c][i];
      s = s > 1 ? 1 : s < -1 ? -1 : s;
      view.setInt16(off, Math.round(s * 32767), true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/* ═══════════════════════════════════════════════════════════════════════ */

export function AudioEditor() {
  const { t, num, lang } = useT();
  const goHome = useAppStore((s) => s.goHome);

  /* audio state */
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);
  const [sel, setSel] = useState<Sel>({ start: 0, end: 0 });
  const [dragging, setDragging] = useState(false);

  /* playback state */
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [saving, setSaving] = useState(false);

  /* refs (mirrors keep stable callbacks fresh — same pattern as pdf-editor) */
  const audioRef = useRef<AudioBuffer | null>(null);
  const selRef = useRef<Sel>(sel);
  const playingRef = useRef(false);
  const volRef = useRef(volume);
  const fiRef = useRef(fadeIn);
  const foRef = useRef(fadeOut);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const t0Ref = useRef(0); // ctx time playback started at
  const playDurRef = useRef(0); // scheduled slice duration
  const dragRef = useRef<{ anchor: number } | null>(null);
  const peaksRef = useRef<Peaks | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* render-body mirrors (always-freshest values for stable callbacks) */
  audioRef.current = audio;
  selRef.current = sel;
  volRef.current = volume;
  fiRef.current = fadeIn;
  foRef.current = fadeOut;

  const duration = audio
    ? Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : audio.length / audio.sampleRate
    : 0;

  /* ── playback helpers ────────────────────────────────────────────────── */

  const stop = useCallback(() => {
    const src = srcRef.current;
    srcRef.current = null;
    playingRef.current = false;
    setPlaying(false);
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, []);

  /** piecewise gain envelope at absolute ctx time (with current vol/fades) */
  const gainAt = useCallback((abs: number): number => {
    const vol = volRef.current;
    const { fi, fo } = effFades(fiRef.current, foRef.current, playDurRef.current);
    const rel = abs - t0Ref.current;
    const dur = playDurRef.current;
    if (rel <= 0) return fi > 0 ? 0.0001 : vol;
    if (rel >= dur) return 0.0001;
    if (fi > 0 && rel < fi) return Math.max(0.0001, vol * (rel / fi));
    if (fo > 0 && rel > dur - fo) return Math.max(0.0001, vol * ((dur - rel) / fo));
    return vol;
  }, []);

  /** re-apply volume/fade slider changes to the live gain node mid-playback */
  const rescheduleGain = useCallback(() => {
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain || !playingRef.current || ctx.state === "closed") return;
    const now = ctx.currentTime;
    const g = gain.gain;
    const vol = volRef.current;
    const { fi, fo } = effFades(fiRef.current, foRef.current, playDurRef.current);
    const t0 = t0Ref.current;
    const end = t0 + playDurRef.current;
    g.cancelScheduledValues(now);
    g.setValueAtTime(gainAt(now), now);
    if (fi > 0 && now < t0 + fi) g.linearRampToValueAtTime(vol, t0 + fi);
    if (fo > 0) {
      const foStart = end - fo;
      if (now < foStart) g.setValueAtTime(vol, foStart);
      g.linearRampToValueAtTime(0.0001, end);
    }
  }, [gainAt]);

  const play = useCallback(() => {
    const buf = audioRef.current;
    if (!buf || playingRef.current) return;
    let ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
      ctxRef.current = ctx;
      gainRef.current = null;
    }
    void ctx.resume().catch(() => {});
    if (!gainRef.current) {
      const gn = ctx.createGain();
      gn.connect(ctx.destination);
      gainRef.current = gn;
    }

    const dur = Math.max(0.01, selRef.current.end - selRef.current.start);
    const vol = volRef.current;
    const { fi, fo } = effFades(fiRef.current, foRef.current, dur);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gainRef.current);

    const t0 = ctx.currentTime + 0.03;
    const g = gainRef.current.gain;
    g.cancelScheduledValues(ctx.currentTime);
    if (fi > 0) {
      g.setValueAtTime(0.0001, t0);
      g.linearRampToValueAtTime(vol, t0 + fi);
    } else {
      g.setValueAtTime(vol, t0);
    }
    if (fo > 0) {
      g.setValueAtTime(vol, t0 + dur - fo);
      g.linearRampToValueAtTime(0.0001, t0 + dur);
    }
    src.start(t0, selRef.current.start, dur);
    src.onended = () => {
      if (srcRef.current === src) {
        srcRef.current = null;
        playingRef.current = false;
        setPlaying(false);
      }
    };

    srcRef.current = src;
    t0Ref.current = t0;
    playDurRef.current = dur;
    playingRef.current = true;
    setPlaying(true);
  }, []);

  const stopIfPlaying = useCallback(() => {
    if (playingRef.current) stop();
  }, [stop]);

  /* unmount hygiene: kill source + close the shared AudioContext */
  useEffect(() => {
    return () => {
      const src = srcRef.current;
      if (src) {
        src.onended = null;
        try {
          src.stop();
        } catch {
          /* ignore */
        }
      }
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    };
  }, []);

  /* ── selection helpers ───────────────────────────────────────────────── */

  /** normalize + clamp a raw (a,b) pair into a valid selection */
  const clampSel = (a: number, b: number): Sel => {
    const d = duration;
    let s = Math.min(Math.max(Math.min(a, b), 0), Math.max(0, d));
    let e = Math.min(Math.max(Math.max(a, b), 0), Math.max(0, d));
    if (e - s < MIN_SEL) {
      if (d < MIN_SEL) {
        s = 0;
        e = d;
      } else if (s + MIN_SEL <= d) {
        e = s + MIN_SEL;
      } else {
        e = s;
        s = e - MIN_SEL;
      }
    }
    return { start: s, end: e };
  };

  const onStartSlider = (vals: number[]) => {
    stopIfPlaying();
    const v = vals[0] ?? 0;
    const max = Math.max(MIN_SEL, sel.end - MIN_SEL);
    setSel({ start: Math.min(Math.max(0, v), max), end: sel.end });
  };

  const onEndSlider = (vals: number[]) => {
    stopIfPlaying();
    const v = vals[0] ?? 0;
    const min = sel.start + MIN_SEL;
    setSel({ start: sel.start, end: Math.max(min, Math.min(duration, v)) });
  };

  /* ── waveform draw (dpr-aware, cached peaks) ─────────────────────────── */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const buf = audioRef.current;
    if (!canvas || !wrap || !buf) return;

    const cssW = Math.max(1, wrap.clientWidth);
    const cssH = WAVE_H;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    const dur =
      Number.isFinite(buf.duration) && buf.duration > 0
        ? buf.duration
        : buf.length / buf.sampleRate;

    /* per-column min/max peaks (mix ch0+ch1 when stereo) — cached per width */
    const STEP = BAR_W + BAR_GAP;
    const cols = Math.max(1, Math.floor(cssW / STEP));
    const nch = buf.numberOfChannels;
    const ch0 = buf.getChannelData(0);
    const ch1 = nch >= 2 ? buf.getChannelData(1) : null;
    const key = `${cols}:${buf.length}:${nch}`;
    if (!peaksRef.current || peaksRef.current.key !== key) {
      const mins = new Float32Array(cols);
      const maxs = new Float32Array(cols);
      for (let c = 0; c < cols; c++) {
        const i0 = Math.floor((c * buf.length) / cols);
        const i1 = Math.max(i0 + 1, Math.floor(((c + 1) * buf.length) / cols));
        let mn = 1;
        let mx = -1;
        for (let i = i0; i < i1; i++) {
          const s = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
          if (s < mn) mn = s;
          if (s > mx) mx = s;
        }
        if (mn > mx) {
          mn = 0;
          mx = 0;
        }
        mins[c] = mn;
        maxs[c] = mx;
      }
      peaksRef.current = { key, mins, maxs };
    }
    const { mins, maxs } = peaksRef.current;

    /* faint center line */
    const mid = cssH / 2;
    const amp = mid - 4;
    g.fillStyle = "rgba(16,185,129,0.18)";
    g.fillRect(0, Math.round(mid) - 0.5, cssW, 1);

    /* emerald→teal vertical gradient bars */
    const grad = g.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, "#10b981");
    grad.addColorStop(1, "#0d9488");
    g.fillStyle = grad;
    for (let c = 0; c < cols; c++) {
      const x = c * STEP;
      const yTop = mid - maxs[c] * amp;
      const h = Math.max(1.5, (maxs[c] - mins[c]) * amp);
      g.fillRect(x, yTop, BAR_W, h);
    }

    /* selection overlay + rose markers */
    const s01 = Math.min(1, Math.max(0, sel.start / (dur || 1)));
    const e01 = Math.min(1, Math.max(0, sel.end / (dur || 1)));
    const sx = s01 * cssW;
    const ex = e01 * cssW;
    g.fillStyle = "rgba(244,63,94,0.18)";
    g.fillRect(sx, 0, Math.max(2, ex - sx), cssH);
    g.fillStyle = "#f43f5e";
    g.fillRect(Math.round(sx) - 1, 0, 2, cssH);
    g.fillRect(Math.round(ex) - 1, 0, 2, cssH);
  }, [sel, audio]);

  const drawRef = useRef<() => void>(() => {});
  drawRef.current = draw;

  /* redraw when selection / audio changes */
  useEffect(() => {
    draw();
  }, [draw]);

  /* redraw on container resize (peaks recomputed for new width) */
  useEffect(() => {
    if (!audio) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => drawRef.current());
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [audio]);

  /* ── waveform drag-to-select ─────────────────────────────────────────── */

  const timeAt = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * duration;
  };

  const onWavePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!audio) return;
    stopIfPlaying();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const anchor = timeAt(e.clientX);
    dragRef.current = { anchor };
    setSel(clampSel(anchor, anchor + MIN_SEL));
    setDragging(true);
  };

  const onWavePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setSel(clampSel(drag.anchor, timeAt(e.clientX)));
  };

  const onWavePointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  /* ── load / close ────────────────────────────────────────────────────── */

  const openFile = async (file: File | undefined | null) => {
    if (!file || decoding) return;
    setDecoding(true);
    try {
      const ab = await file.arrayBuffer();
      const ctx = new AudioContext();
      let buf: AudioBuffer;
      try {
        buf = await ctx.decodeAudioData(ab);
      } finally {
        try {
          void ctx.close();
        } catch {
          /* ignore */
        }
      }
      const dur =
        Number.isFinite(buf.duration) && buf.duration > 0
          ? buf.duration
          : buf.length / buf.sampleRate;
      if (!Number.isFinite(dur) || dur <= MIN_SEL) throw new Error("bad-duration");

      stop();
      peaksRef.current = null;
      setFileMeta({ name: file.name || "audio", size: file.size });
      setAudio(buf);
      setSel({ start: 0, end: dur });
      setVolume(1);
      setFadeIn(0);
      setFadeOut(0);
    } catch {
      toast.error(t("aeLoadFail"));
    } finally {
      setDecoding(false);
    }
  };

  const closeFile = () => {
    stop();
    const ctx = ctxRef.current;
    ctxRef.current = null;
    gainRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    peaksRef.current = null;
    setPlaying(false);
    setAudio(null);
    setFileMeta(null);
    setSel({ start: 0, end: 0 });
  };

  /* ── export WAV ──────────────────────────────────────────────────────── */

  const handleSave = async () => {
    const buf = audioRef.current;
    if (!buf || saving) return;
    setSaving(true);
    try {
      const sr = buf.sampleRate;
      const s0 = Math.max(0, Math.floor(sel.start * sr));
      const s1 = Math.min(buf.length, Math.floor(sel.end * sr));
      const len = s1 - s0;
      if (len <= 0) throw new Error("empty-selection");

      /* extract slice — >2 channels are averaged down to mono, ≤2 kept as-is */
      const nch = buf.numberOfChannels;
      let channels: Float32Array[];
      if (nch > 2) {
        const mono = new Float32Array(len);
        for (let c = 0; c < nch; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < len; i++) mono[i] += d[s0 + i] / nch;
        }
        channels = [mono];
      } else {
        channels = [];
        for (let c = 0; c < nch; c++) channels.push(buf.getChannelData(c).slice(s0, s1));
      }

      /* gain + fades (windows clamped so they never overlap or exceed) */
      const vol = volume;
      const selDur = sel.end - sel.start;
      const fiN = Math.min(len, Math.round(Math.max(0, Math.min(fadeIn, selDur / 2)) * sr));
      const foN = Math.min(len - fiN, Math.round(Math.max(0, Math.min(fadeOut, selDur / 2)) * sr));
      for (const ch of channels) {
        for (let i = 0; i < len; i++) {
          let x = ch[i] * vol;
          if (fiN > 0 && i < fiN) x *= i / fiN;
          if (foN > 0 && i >= len - foN) x *= 1 - (i - (len - foN)) / foN;
          ch[i] = x > 1 ? 1 : x < -1 ? -1 : x;
        }
      }

      const blob = encodeWav(channels, sr);
      const base = stripExt(fileMeta?.name ?? "audio") || "audio";
      downloadBlob(blob, `${base}-edited.wav`);
      toast.success(t("aeSaved"));
    } catch {
      toast.error(t("aeSaveFail"));
    } finally {
      setSaving(false);
    }
  };

  /* ── derived ui bits ─────────────────────────────────────────────────── */
  const selLen = Math.max(0, sel.end - sel.start);
  const startSliderMax = Math.max(MIN_SEL, sel.end - MIN_SEL);
  const endSliderMin = sel.start + MIN_SEL;
  const endSliderMax = Math.max(endSliderMin + 0.01, duration);

  /* ═══════════════════════════════════ render ═══════════════════════ */

  if (!audio) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:px-6" aria-label={t("aeEditorAria")}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="fm-card rounded-3xl p-8 text-center sm:p-12"
        >
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
            <AudioLines className="h-8 w-8 text-white" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-emerald-950 sm:text-2xl">{t("aeTitle")}</h1>
          <p className="mt-2 text-sm text-emerald-900/60">{t("aeDropHint")}</p>

          {decoding ? (
            <div className="mt-8 flex items-center justify-center gap-2 text-emerald-700">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">{t("aeDecode")}</span>
            </div>
          ) : (
            <>
              <div
                role="button"
                tabIndex={0}
                aria-label={t("aePick")}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
                }}
                className="mt-8 cursor-pointer rounded-2xl border-2 border-dashed border-emerald-500/25 bg-emerald-50/40 px-6 py-10 outline-none transition hover:border-emerald-500/50 hover:bg-emerald-50/70 focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                <UploadCloud className="mx-auto h-8 w-8 text-emerald-600/70" />
                <p className="mt-3 font-semibold text-emerald-950/85">{t("aeDrop")}</p>
                <Button className="btn-shine mt-4 bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700">
                  {t("aePick")}
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-emerald-900/50">
                {[t("aeTrim"), t("aeVolume"), t("aeFadeIn"), t("aeFadeOut"), "WAV 16-bit"].map(
                  (chip, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-emerald-600/10 bg-emerald-50/70 px-3 py-1 font-medium"
                    >
                      {chip}
                    </span>
                  )
                )}
              </div>
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
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
    <section className="flex min-h-[calc(100vh-4rem)] flex-col" aria-label={t("aeEditorAria")}>
      {/* ── toolbar: back · file · info · save ─────────────────────────── */}
      <div className="sticky top-16 z-20 border-b border-emerald-900/[0.06] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={goHome}
            aria-label={lang === "en" ? "Back" : "ফিরে যান"}
            className="h-9 text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{lang === "en" ? "Back" : "ফিরে যান"}</span>
          </Button>

          <AudioLines className="h-4 w-4 shrink-0 text-teal-600" />
          <span className="hidden min-w-0 max-w-[180px] truncate text-sm font-semibold text-emerald-950 md:block">
            {fileMeta?.name}
          </span>

          {/* duration · sample rate · channels */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-emerald-600/10 bg-emerald-50/70 px-2.5 py-1 text-xs font-semibold tabular-nums text-emerald-800">
              {t("aeDuration")}: {num(duration.toFixed(1))}s
            </span>
            <span className="rounded-full border border-teal-600/10 bg-teal-50/70 px-2.5 py-1 text-xs font-semibold tabular-nums text-teal-700">
              {num((audio.sampleRate / 1000).toFixed(1))} kHz
            </span>
            <span className="hidden rounded-full border border-emerald-600/10 bg-emerald-50/70 px-2.5 py-1 text-xs font-semibold tabular-nums text-emerald-800 sm:inline">
              {num(audio.numberOfChannels)} ch
            </span>
            {fileMeta ? (
              <span className="hidden rounded-full border border-emerald-600/10 bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-emerald-900/60 sm:inline">
                {formatBytes(fileMeta.size)}
              </span>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={closeFile}
              aria-label={lang === "en" ? "Close file" : "ফাইল বন্ধ করুন"}
              title={lang === "en" ? "Close file" : "ফাইল বন্ধ করুন"}
              className="rounded-xl border border-emerald-900/[0.07] bg-white p-2 text-emerald-900/70 shadow-sm transition hover:bg-rose-50 hover:text-rose-600"
            >
              <X className="h-4 w-4" />
            </button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="btn-shine inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-500/25 transition hover:brightness-105 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {saving ? t("aeSaving") : t("aeSave")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── waveform + trim ────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-5xl px-3 pb-16 pt-5 sm:px-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="fm-card rounded-2xl p-4 sm:p-6"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-600">
              <Scissors className="h-3.5 w-3.5" />
              {t("aeTrim")}
            </span>
            <span className="rounded-full border border-rose-500/20 bg-white px-2.5 py-1 text-xs font-bold tabular-nums text-rose-600">
              {num(selLen.toFixed(2))}s
            </span>
            <span className="ml-auto text-xs font-medium tabular-nums text-emerald-900/60">
              {t("aeStart")} {num(sel.start.toFixed(2))}s · {t("aeEnd")} {num(sel.end.toFixed(2))}s
            </span>
          </div>

          <div
            ref={wrapRef}
            className={`overflow-hidden rounded-xl border bg-gradient-to-b from-emerald-50/60 to-teal-50/40 transition ${
              dragging ? "border-rose-500/50" : "border-emerald-900/10"
            }`}
          >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`${t("aeEditorAria")} — ${t("aeTrim")}`}
              className="block h-40 w-full cursor-crosshair touch-none select-none"
              style={{ touchAction: "none" }}
              onPointerDown={onWavePointerDown}
              onPointerMove={onWavePointerMove}
              onPointerUp={onWavePointerUp}
              onPointerCancel={onWavePointerUp}
            />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ae-start" className="text-xs font-semibold text-emerald-900/70">
                  {t("aeStart")}
                </Label>
                <span className="text-xs font-bold tabular-nums text-emerald-900">
                  {num(sel.start.toFixed(2))}s
                </span>
              </div>
              <Slider
                id="ae-start"
                min={0}
                max={startSliderMax}
                step={0.01}
                value={[Math.min(sel.start, startSliderMax)]}
                onValueChange={onStartSlider}
                aria-label={t("aeStart")}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ae-end" className="text-xs font-semibold text-emerald-900/70">
                  {t("aeEnd")}
                </Label>
                <span className="text-xs font-bold tabular-nums text-emerald-900">
                  {num(sel.end.toFixed(2))}s
                </span>
              </div>
              <Slider
                id="ae-end"
                min={endSliderMin}
                max={endSliderMax}
                step={0.01}
                value={[Math.max(sel.end, endSliderMin)]}
                onValueChange={onEndSlider}
                aria-label={t("aeEnd")}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-emerald-900/50">
            {lang === "en"
              ? "Tip: drag directly on the waveform to select the region to keep."
              : "টিপ: যে অংশ রাখবেন সেটি বাছতে ওয়েভফর্মে সরাসরি টেনে দিন।"}
          </p>
        </motion.div>

        {/* ── playback ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="fm-card mt-5 rounded-2xl p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                onClick={playing ? stop : play}
                aria-label={playing ? t("aePause") : t("aePlay")}
                title={playing ? t("aePause") : t("aePlay")}
                className={`btn-shine inline-flex h-12 w-12 items-center justify-center rounded-full p-0 text-white shadow-lg transition ${
                  playing
                    ? "bg-gradient-to-br from-rose-500 to-rose-600 shadow-rose-500/30 hover:from-rose-600 hover:to-rose-700"
                    : "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30 hover:from-emerald-600 hover:to-teal-700"
                }`}
              >
                {playing ? <Square className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
              <Button
                onClick={stop}
                disabled={!playing}
                variant="outline"
                aria-label={t("aeStop")}
                title={t("aeStop")}
                className="h-10 w-10 rounded-full border-emerald-900/10 p-0 text-emerald-900/70 hover:bg-emerald-50 hover:text-emerald-900"
              >
                <Square className="h-4 w-4" />
              </Button>
              {playing ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                  {t("aePlay")}
                </span>
              ) : null}
            </div>

            <div className="min-w-[180px] flex-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ae-volume" className="text-xs font-semibold text-emerald-900/70">
                  {t("aeVolume")}
                </Label>
                <span className="text-xs font-bold tabular-nums text-emerald-900">
                  {num(volume.toFixed(2))}×
                </span>
              </div>
              <Slider
                id="ae-volume"
                min={0}
                max={2}
                step={0.05}
                value={[volume]}
                onValueChange={(vals) => {
                  const v = vals[0] ?? 1;
                  setVolume(v);
                  volRef.current = v;
                  rescheduleGain();
                }}
                aria-label={t("aeVolume")}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ae-fadein" className="text-xs font-semibold text-emerald-900/70">
                  {t("aeFadeIn")}
                </Label>
                <span className="text-xs font-bold tabular-nums text-emerald-900">
                  {num(fadeIn.toFixed(1))}s
                </span>
              </div>
              <Slider
                id="ae-fadein"
                min={0}
                max={5}
                step={0.1}
                value={[fadeIn]}
                onValueChange={(vals) => {
                  const v = vals[0] ?? 0;
                  setFadeIn(v);
                  fiRef.current = v;
                  rescheduleGain();
                }}
                aria-label={t("aeFadeIn")}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ae-fadeout" className="text-xs font-semibold text-emerald-900/70">
                  {t("aeFadeOut")}
                </Label>
                <span className="text-xs font-bold tabular-nums text-emerald-900">
                  {num(fadeOut.toFixed(1))}s
                </span>
              </div>
              <Slider
                id="ae-fadeout"
                min={0}
                max={5}
                step={0.1}
                value={[fadeOut]}
                onValueChange={(vals) => {
                  const v = vals[0] ?? 0;
                  setFadeOut(v);
                  foRef.current = v;
                  rescheduleGain();
                }}
                aria-label={t("aeFadeOut")}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
