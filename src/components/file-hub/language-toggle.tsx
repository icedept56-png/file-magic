"use client";

import { motion } from "framer-motion";
import { Languages } from "lucide-react";

import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/** Segmented বাংলা ⇄ English switcher with a sliding active pill (Day 21) */
export function LanguageToggle() {
  const { lang } = useT();
  const setLang = useAppStore((s) => s.setLang);

  return (
    <div
      role="group"
      aria-label="ভাষা বাছাই / Language selection"
      className="flex items-center gap-0.5 rounded-full border border-emerald-600/15 bg-white p-0.5 shadow-sm"
    >
      <Languages className="ml-2 h-3.5 w-3.5 shrink-0 text-emerald-600/70" aria-hidden="true" />
      {(
        [
          ["bn", "বাংলা"],
          ["en", "English"],
        ] as const
      ).map(([id, label]) => {
        const active = lang === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (!active) haptic("select");
              setLang(id);
            }}
            aria-pressed={active}
            className={`relative rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              active ? "text-white" : "text-emerald-900/60 hover:text-emerald-800"
            }`}
          >
            {active && (
              <motion.span
                layoutId="fm-lang-pill"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 shadow-sm shadow-emerald-500/30"
              />
            )}
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
