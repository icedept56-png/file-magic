"use client";

import { motion } from "framer-motion";

import { CATEGORIES } from "@/lib/tools/registry";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

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
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                active
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-emerald-500/25"
                  : "border border-emerald-900/[0.07] bg-white text-emerald-900/70 hover:bg-emerald-50"
              }`}
            >
              {lang === "en" ? (c.labelEn ?? c.label) : c.label}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
