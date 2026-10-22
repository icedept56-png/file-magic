"use client";

import { motion } from "framer-motion";

import { CATEGORIES } from "@/lib/tools/registry";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/** per-category colored dot (eye-catching, matches sidebar tinting) */
const CATEGORY_DOT: Record<string, string> = {
  all: "bg-gradient-to-br from-emerald-500 to-teal-600",
  pdf: "bg-gradient-to-br from-rose-500 to-red-600",
  image: "bg-gradient-to-br from-fuchsia-500 to-purple-600",
  document: "bg-gradient-to-br from-orange-500 to-amber-600",
  spreadsheet: "bg-gradient-to-br from-emerald-500 to-teal-600",
  archive: "bg-gradient-to-br from-teal-500 to-cyan-600",
  utility: "bg-gradient-to-br from-pink-500 to-rose-600",
};

/** Mobile-only horizontal category chips (desktop uses the sidebar) */
export function CategoryTabs() {
  const { t, lang } = useT();
  const category = useAppStore((s) => s.category);
  const setCategory = useAppStore((s) => s.setCategory);
  const view = useAppStore((s) => s.view);
  const goHome = useAppStore((s) => s.goHome);

  const select = (id: string) => {
    if (view === "tool") goHome();
    setCategory(id);
  };

  return (
    <section className="mt-6 lg:hidden" aria-label={t("pickCategory")}>
      <div className="fm-scroll mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-4 pb-1 sm:px-6">
        {CATEGORIES.map((c) => {
          const active = category === c.id && view === "home";
          return (
            <motion.button
              key={c.id}
              type="button"
              onClick={() => select(c.id)}
              aria-pressed={active}
              whileTap={{ scale: 0.96 }}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                active
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-emerald-500/25"
                  : "border border-emerald-900/[0.07] bg-white text-emerald-900/70 hover:bg-emerald-50"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${CATEGORY_DOT[c.id] ?? "bg-emerald-500"} ${active ? "ring-1 ring-white/60" : ""}`}
              />
              {lang === "en" ? (c.labelEn ?? c.label) : c.label}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
