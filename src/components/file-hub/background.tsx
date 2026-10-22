"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient background — tuned for long sessions:
 *  - very low-saturation aurora washes (no vivid spots that tire the eyes)
 *  - soft dot grid that fades out below the hero
 *  - gentle pointer spotlight, disabled for reduced-motion users
 */
export function Background() {
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = spotRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let px = 0;
    let py = 0;
    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          el.style.setProperty("--mx", `${px}px`);
          el.style.setProperty("--my", `${py}px`);
          el.style.setProperty("--mspot", "1");
        });
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* base vertical wash: mint → white → warm ivory (calm, low contrast) */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#edf6f0_0%,#f4faf6_38%,#f6f7f2_100%)]" />

      {/* aurora washes — big, blurred, pastel (animates very slowly) */}
      <div className="fm-orb-1 absolute left-[-10%] top-[-14%] h-[520px] w-[520px] rounded-full bg-emerald-200/35 blur-[110px]" />
      <div className="fm-orb-2 absolute right-[-12%] top-[22%] h-[480px] w-[480px] rounded-full bg-teal-100/45 blur-[120px]" />
      <div className="fm-orb-3 absolute bottom-[-16%] left-[24%] h-[460px] w-[460px] rounded-full bg-amber-100/40 blur-[110px]" />
      <div className="fm-orb-2 absolute left-[-8%] top-[55%] h-[380px] w-[380px] rounded-full bg-rose-100/35 blur-[110px]" />

      {/* soft dot grid — calmer than lines, fades out under the fold */}
      <div className="fm-grid absolute inset-0" />

      {/* horizon beam — subtle depth behind the header */}
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(16,185,129,0.07),transparent_70%)]" />

      {/* pointer spotlight */}
      <div
        ref={spotRef}
        className="absolute inset-0 opacity-[var(--mspot,0)] transition-opacity duration-700"
        style={{
          background:
            "radial-gradient(620px circle at var(--mx, 50%) var(--my, 30%), rgba(16,185,129,0.055), rgba(20,184,166,0.03) 40%, transparent 70%)",
        }}
      />

      {/* gentle vignette for edge comfort */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_40%,transparent_60%,rgba(13,31,22,0.035)_100%)]" />
    </div>
  );
}
