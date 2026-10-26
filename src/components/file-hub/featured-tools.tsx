"use client";

import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, FileText, FileType2, Flame } from "lucide-react";

import { getTool } from "@/lib/tools/registry";
import { pick, useT } from "@/lib/i18n";
import type { ToolDef } from "@/lib/tools/types";
import { useAppStore } from "@/store/app-store";

/** ids highlighted in the "quick start" section */
const FEATURED_IDS = ["pdf-to-docx", "merge-pdf", "image-convert", "qr-generator"];

const FEATURED_TINT: Record<string, string> = {
  "pdf-to-docx": "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/40",
  "merge-pdf": "bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/40",
  "image-convert": "bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-fuchsia-500/40",
  "qr-generator": "bg-gradient-to-br from-pink-500 to-rose-600 shadow-pink-500/40",
};

/** animated PDF → DOCX mini preview (decorative) */
function ConvertPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-32 w-full max-w-[300px] items-center justify-center gap-3 overflow-hidden rounded-2xl border border-emerald-900/[0.06] bg-gradient-to-br from-emerald-50 via-teal-50 to-orange-100/70 shadow-inner"
    >
      {/* soft corner glows */}
      <span className="absolute -left-6 -top-6 h-20 w-20 rounded-full bg-rose-300/30 blur-2xl" />
      <span className="absolute -bottom-7 -right-5 h-24 w-24 rounded-full bg-orange-300/40 blur-2xl" />

      <motion.span
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex h-16 w-14 flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/40"
      >
        <FileText className="h-5 w-5" />
        <span className="text-[10px] font-bold tracking-wide">PDF</span>
      </motion.span>

      <motion.span
        animate={{ x: [0, 5, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        className="relative grid h-9 w-9 place-items-center rounded-full bg-white text-emerald-600 shadow-md shadow-emerald-900/10"
      >
        <ArrowRight className="h-4 w-4" />
      </motion.span>

      <motion.span
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="relative flex h-16 w-14 flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/40"
      >
        <FileType2 className="h-5 w-5" />
        <span className="text-[10px] font-bold tracking-wide">DOCX</span>
      </motion.span>
    </div>
  );
}

/** Big white quick-start cards (reference dashboard style) */
export function FeaturedTools() {
  const { t, lang } = useT();
  const openTool = useAppStore((s) => s.openTool);

  const tools = FEATURED_IDS.map((id) => getTool(id)).filter(
    (t): t is NonNullable<typeof t> => Boolean(t)
  );
  if (tools.length === 0) return null;

  const [hero, ...rest] = tools;

  const cardBase =
    "fm-card fm-card-hover group rounded-2xl text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/60";

  return (
    <section id="fm-featured" className="mt-8 scroll-mt-24" aria-label={t("featuredAria")}>
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {/* ── hero banner (PDF → Word) ─────────────────────────── */}
        {hero && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => openTool(hero.id)}
            aria-label={`${pick(lang, hero.name, hero.nameEn)} — ${pick(lang, hero.desc, hero.descEn)}`}
            className={`${cardBase} relative col-span-1 flex flex-col items-start gap-5 overflow-hidden p-5 sm:col-span-2 sm:flex-row sm:items-center sm:gap-6 sm:p-6 lg:col-span-3`}
          >
            {/* ambient wash */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-r from-rose-500/[0.05] via-transparent to-emerald-500/[0.07]"
            />

            <div className="relative min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl shadow-lg ${FEATURED_TINT[hero.id] ?? "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/40"}`}
                >
                  <hero.icon className="h-6 w-6 text-white" />
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-orange-600/20 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">
                  <Flame className="h-3.5 w-3.5" />
                  {t("featuredHeroBadge")}
                </span>
              </div>

              <h3 className="mt-4 text-xl font-bold text-emerald-950 sm:text-2xl">
                {pick(lang, hero.name, hero.nameEn)}
              </h3>
              <p className="mt-1 max-w-md text-sm text-emerald-900/60 sm:text-base">
                {pick(lang, hero.desc, hero.descEn)}
              </p>

              <span className="btn-shine mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-transform duration-300 group-hover:scale-[1.03]">
                {t("featuredStart")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>

            <div className="relative hidden w-full shrink-0 justify-end sm:flex sm:w-auto">
              <ConvertPreview />
            </div>
          </motion.button>
        )}

        {/* ── compact quick-start cards ────────────────────────── */}
        {rest.map((tool: ToolDef, i: number) => (
          <motion.button
            key={tool.id}
            type="button"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.14 + i * 0.05 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.985 }}
            onClick={() => openTool(tool.id)}
            aria-label={`${pick(lang, tool.name, tool.nameEn)} — ${pick(lang, tool.desc, tool.descEn)}`}
            className={`${cardBase} col-span-1 flex items-center gap-3.5 p-4 sm:gap-4 sm:p-5`}
          >
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-110 ${
                FEATURED_TINT[tool.id] ?? "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/40"
              }`}
            >
              <tool.icon className="h-6 w-6 text-white" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-bold text-emerald-950">
                {pick(lang, tool.name, tool.nameEn)}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-sm text-emerald-900/60">
                {pick(lang, tool.desc, tool.descEn)}
              </span>
            </span>

            <ArrowUpRight className="h-5 w-5 shrink-0 -translate-x-1 translate-y-1 text-emerald-600/40 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-emerald-600 group-hover:opacity-100" />
          </motion.button>
        ))}
      </div>
    </section>
  );
}
