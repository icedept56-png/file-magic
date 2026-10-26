"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Compass, Search, ShieldCheck, LayoutGrid, Star, Keyboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { TOOL_COUNT } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";

const FLAG = "fm-onboarded-v1";
const EVENT = "fm-open-tour";

/** replay the tour from anywhere (navbar button, help entry…) */
export function openOnboardingTour() {
  // the tour spotlights home-only anchors — always return home first
  useAppStore.getState().goHome();
  window.dispatchEvent(new CustomEvent(EVENT));
}

interface Step {
  icon: React.ComponentType<{ className?: string }>;
  sel: string;
  titleKey: "obSearch" | "obPrivacy" | "obFeatured" | "obGrid" | "obShortcuts";
  bodyKey: "obSearchBody" | "obPrivacyBody" | "obFeaturedBody" | "obGridBody" | "obShortcutsBody";
  /** dynamic tail appended to the title (e.g. tool count) */
  titleTail?: (num: (v: number | string) => string) => string;
}

const STEPS: Step[] = [
  {
    icon: Search,
    sel: 'input[aria-label="টুল খুঁজুন"], input[aria-label="Search tools"]',
    titleKey: "obSearch",
    bodyKey: "obSearchBody",
  },
  {
    icon: ShieldCheck,
    sel: "#fm-hero-stats",
    titleKey: "obPrivacy",
    bodyKey: "obPrivacyBody",
  },
  {
    icon: Star,
    sel: "#fm-featured",
    titleKey: "obFeatured",
    bodyKey: "obFeaturedBody",
  },
  {
    icon: LayoutGrid,
    sel: "#tools",
    titleKey: "obGrid",
    bodyKey: "obGridBody",
    titleTail: (num) => ` — ${num(TOOL_COUNT)}`,
  },
  {
    icon: Keyboard,
    sel: "#fm-sk-btn",
    titleKey: "obShortcuts",
    bodyKey: "obShortcutsBody",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** first-visit spotlight tour over the home screen (Day 13 — 60-day roadmap) */
export function OnboardingTour() {
  const { t, num, lang } = useT();
  const view = useAppStore((s) => s.view);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const rafRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(FLAG, "1");
    } catch {
      /* private mode — ignore */
    }
  }, []);

  // first run: only when no flag exists; replay: via custom event
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!window.localStorage.getItem(FLAG)) {
        timer = setTimeout(() => setOpen(true), 900);
      }
    } catch {
      /* private mode — never show first-run tour */
    }
    const onOpen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(EVENT, onOpen);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(EVENT, onOpen);
    };
  }, []);

  const active = open && view === "home";

  // measure the current target every frame while active (handles scroll,
  // resize, hero entrance animations — one querySelector/frame is cheap).
  // NOTE: no rect reset when inactive — render returns null then, and the
  // loop re-measures fresh on reopen.
  useEffect(() => {
    if (!active) return;
    const loop = () => {
      const el = document.querySelector(STEPS[step].sel);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev &&
          Math.abs(prev.top - r.top) < 0.5 &&
          Math.abs(prev.left - r.left) < 0.5 &&
          Math.abs(prev.width - r.width) < 0.5
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height }
        );
      } else {
        setRect(null);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    // scroll the target into view once per step
    const t = setTimeout(() => {
      document
        .querySelector(STEPS[step].sel)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      primaryRef.current?.focus();
    }, 60);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(t);
    };
  }, [active, step]);

  // keyboard: Esc skips, arrows move (Enter uses the focused button natively)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setStep((s) => Math.min(s + 1, STEPS.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStep((s) => Math.max(s - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  if (!active) return null;

  const cur = STEPS[step];
  const Icon = cur.icon;
  const pad = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cardW = Math.min(368, vw - 32);

  // card placement: below the hole when it fits, otherwise above; clamped
  let cardTop = 0;
  let cardLeft = 0;
  if (rect) {
    const below = rect.top + rect.height + pad + 14;
    const estimatedH = 240;
    cardTop = below + estimatedH < vh ? below : Math.max(12, rect.top - pad - 14 - estimatedH);
    cardLeft = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 12);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="fm-ob-title">
      {/* layer 1 — click blocker over everything */}
      <div className="fixed inset-0 z-[90]" />

      {/* layer 2 — spotlight hole (giant box-shadow darkens the rest) */}
      {rect && (
        <motion.div
          key={`hole-${step}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          aria-hidden="true"
          className="pointer-events-none fixed z-[91] rounded-2xl"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(4,40,36,0.62)",
            outline: "2px solid rgba(16,185,129,0.85)",
            outlineOffset: 2,
            transition: "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease",
          }}
        />
      )}

      {/* layer 3 — the guide card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`card-${step}-${lang}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="fixed z-[92] rounded-2xl border border-emerald-900/10 bg-white p-5 shadow-2xl shadow-emerald-950/20"
          style={{ top: cardTop, left: cardLeft, width: cardW }}
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25">
              <Icon className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0">
              <p id="fm-ob-title" className="flex items-center gap-2 text-base font-bold text-emerald-950">
                {t(cur.titleKey)}
                {cur.titleTail && (
                  <span className="text-emerald-700">{cur.titleTail(num)}</span>
                )}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-emerald-900/70">{t(cur.bodyKey)}</p>
            </div>
          </div>

          {/* step dots */}
          <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-2 rounded-full transition-all duration-200 ${
                  i === step ? "w-5 bg-emerald-600" : "w-2 bg-emerald-600/25"
                }`}
              />
            ))}
            <span className="ml-auto text-xs font-medium text-emerald-900/50">
              {num(step + 1)} / {num(STEPS.length)}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={close}
              className="h-11 text-emerald-900/55 hover:bg-emerald-600/10 hover:text-emerald-800"
            >
              {t("obSkip")}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {step > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setStep((s) => s - 1)}
                  className="h-11 border-emerald-600/25 text-emerald-800 hover:bg-emerald-50"
                >
                  {t("obBack")}
                </Button>
              )}
              <Button
                ref={primaryRef}
                onClick={() => (step === STEPS.length - 1 ? close() : setStep((s) => s + 1))}
                className="h-11 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-md shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
              >
                {step === STEPS.length - 1 ? t("obDone") : t("obNext")}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** small navbar entry to replay the tour */
export function TourButton() {
  const { t } = useT();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={openOnboardingTour}
      aria-label={t("obReplayAria")}
      title={t("obReplay")}
      className="h-10 w-10 rounded-xl text-emerald-900/70 hover:bg-emerald-600/10 hover:text-emerald-900"
    >
      <Compass className="h-4 w-4" />
    </Button>
  );
}
