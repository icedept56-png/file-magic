"use client";

import { motion } from "framer-motion";
import { ArrowRight, Eraser, Highlighter, ImagePlus, SquarePen, Type } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/** Full-width premium spotlight banner for the PDF editor canvas */
export function EditorSpotlight() {
  const { t } = useT();
  const openTool = useAppStore((s) => s.openTool);

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.06 }}
      className="mt-8"
      aria-label={t("edSpotAria")}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <button
          type="button"
          onClick={() => openTool("pdf-editor")}
          aria-label={t("edSpotAria")}
          className="group relative block w-full overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 p-6 text-left shadow-[0_24px_60px_-24px_rgba(6,78,59,0.55)] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-emerald-400 sm:p-8 lg:p-10"
        >
          {/* decorative glows + grid */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-rose-500/25 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-teal-400/20 blur-3xl"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:radial-gradient(rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:22px_22px]"
          />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-100 backdrop-blur">
                <SquarePen className="h-3.5 w-3.5" />
                {t("edSpotBadge")}
              </span>
              <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
                {t("edSpotTitle")}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-emerald-100/75 sm:text-base">
                {t("edSpotDesc")}
              </p>
              <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-500 to-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-900/40 transition-transform duration-300 group-hover:scale-[1.04]">
                {t("edSpotCta")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>

            {/* mini tool glyphs */}
            <div
              aria-hidden="true"
              className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2"
            >
              {[
                { Icon: Eraser, tint: "from-rose-500 to-red-600 shadow-rose-500/40" },
                { Icon: Type, tint: "from-orange-500 to-amber-600 shadow-orange-500/40" },
                { Icon: ImagePlus, tint: "from-fuchsia-500 to-purple-600 shadow-fuchsia-500/40" },
                { Icon: Highlighter, tint: "from-teal-500 to-cyan-600 shadow-teal-500/40" },
              ].map(({ Icon, tint }, i) => (
                <motion.span
                  key={i}
                  animate={{ y: [0, i % 2 ? 5 : -5, 0] }}
                  transition={{
                    duration: 2.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.35,
                  }}
                  className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg sm:h-14 sm:w-14 ${tint}`}
                >
                  <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                </motion.span>
              ))}
            </div>
          </div>
        </button>
      </div>
    </motion.section>
  );
}
