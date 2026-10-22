"use client";

import { useEffect, useRef } from "react";

/** Ambient background: pastel orbs + grid + pointer spotlight (light theme) */
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
      {/* pastel ambient orbs */}
      <div className="fm-orb-1 absolute left-[-80px] top-[-120px] h-[460px] w-[460px] rounded-full bg-emerald-300/40 blur-3xl" />
      <div className="fm-orb-2 absolute right-[-120px] top-[25%] h-[420px] w-[420px] rounded-full bg-teal-200/50 blur-3xl" />
      <div className="fm-orb-3 absolute bottom-[-140px] left-[30%] h-[400px] w-[400px] rounded-full bg-orange-200/40 blur-3xl" />

      {/* faint grid overlay */}
      <div className="fm-grid absolute inset-0" />

      {/* pointer spotlight */}
      <div
        ref={spotRef}
        className="absolute inset-0 opacity-[var(--mspot,0)] transition-opacity duration-700"
        style={{
          background:
            "radial-gradient(560px circle at var(--mx, 50%) var(--my, 30%), rgba(16,185,129,0.08), rgba(20,184,166,0.04) 40%, transparent 70%)",
        }}
      />
    </div>
  );
}
