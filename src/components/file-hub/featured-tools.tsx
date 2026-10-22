"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { getTool } from "@/lib/tools/registry";
import { pick, useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/** ids highlighted in the "quick start" section */
const FEATURED_IDS = ["pdf-to-docx", "merge-pdf", "image-convert", "qr-generator"];

const FEATURED_TINT: Record<string, string> = {
  "pdf-to-docx": "bg-rose-500",
  "merge-pdf": "bg-rose-500",
  "image-convert": "bg-fuchsia-500",
  "qr-generator": "bg-pink-500",
};

/** Big white quick-start cards (reference dashboard style) */
export function FeaturedTools() {
  const { t, lang } = useT();
  const openTool = useAppStore((s) => s.openTool);

  const tools = FEATURED_IDS.map((id) => getTool(id)).filter(
    (t): t is NonNullable<typeof t> => Boolean(t)
  );
  if (tools.length === 0) return null;

  return (
    <section className="mt-8" aria-label={t("featuredAria")}>
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 px-4 sm:grid-cols-2 sm:px-6">
        {tools.map((tool, i) => (
          <motion.button
            key={tool.id}
            type="button"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.985 }}
            onClick={() => openTool(tool.id)}
            aria-label={`${pick(lang, tool.name, tool.nameEn)} — ${pick(lang, tool.desc, tool.descEn)}`}
            className={`fm-card fm-card-hover group flex flex-col rounded-2xl p-5 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              i === 0 ? "sm:col-span-2 sm:flex-row sm:items-center sm:gap-6" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <span
                className={`grid h-11 w-11 place-items-center rounded-xl shadow-lg ${
                  FEATURED_TINT[tool.id] ?? "bg-emerald-500"
                }`}
              >
                <tool.icon className="h-5 w-5 text-white" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-emerald-950">
                {pick(lang, tool.name, tool.nameEn)}
              </h3>
              <p className="mt-1 line-clamp-2 text-sm text-emerald-900/60">
                {pick(lang, tool.desc, tool.descEn)}
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 transition-colors group-hover:text-emerald-700">
                {t("featuredStart")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>

            {/* decorative mini-preview for the hero card */}
            {i === 0 && (
              <div
                aria-hidden="true"
                className="mt-5 hidden shrink-0 sm:mt-0 sm:block"
              >
                <div className="flex h-28 w-44 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-emerald-50 via-teal-50 to-orange-50">
                  <span className="grid h-12 w-9 place-items-center rounded-lg bg-rose-500/90 text-[10px] font-bold text-white shadow-md">
                    PDF
                  </span>
                  <ArrowRight className="h-4 w-4 text-emerald-600" />
                  <span className="grid h-12 w-9 place-items-center rounded-lg bg-blue-500/90 text-[10px] font-bold text-white shadow-md">
                    DOCX
                  </span>
                </div>
              </div>
            )}
          </motion.button>
        ))}
      </div>
    </section>
  );
}
