"use client";

import { Languages } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/** Segmented বাংলা ⇄ English switcher */
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
            onClick={() => setLang(id)}
            aria-pressed={active}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              active
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/30"
                : "text-emerald-900/60 hover:text-emerald-800"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
