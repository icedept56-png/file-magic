"use client";

import { useEffect, useRef } from "react";

/** Ambient background: floating orbs + grid + a pointer-tracking spotlight */
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
      {/* ambient orbs */}
      <div className="fm-orb-1 absolute left-[-80px] top-[-120px] h-[480px] w-[480px] rounded-full bg-fuchsia-600 opacity-[0.22] blur-3xl" />
      <div className="fm-orb-2 absolute right-[-120px] top-[30%] h-[420px] w-[420px] rounded-full bg-violet-600 opacity-[0.22] blur-3xl" />
      <div className="fm-orb-3 absolute bottom-[-140px] left-[30%] h-[400px] w-[400px] rounded-full bg-orange-500 opacity-[0.22] blur-3xl" />

      {/* faint grid overlay */}
      <div className="fm-grid absolute inset-0" />

      {/* pointer spotlight (desktop, fine pointers) */}
      <div
        ref={spotRef}
        className="absolute inset-0 opacity-[var(--mspot,0)] transition-opacity duration-700"
        style={{
          background:
            "radial-gradient(560px circle at var(--mx, 50%) var(--my, 30%), rgba(217,70,239,0.075), rgba(139,92,246,0.04) 40%, transparent 70%)",
        }}
      />

      {/* subtle vignette pulling edges into the base color */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(7,7,13,0.8)_100%)]" />
    </div>
  );
}
