"use client";

import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

import { CATEGORIES } from "@/lib/tools/registry";
import { pick, useT } from "@/lib/i18n";
import type { ToolDef } from "@/lib/tools/types";
import { useAppStore } from "@/store/app-store";

interface ToolCardProps {
  tool: ToolDef;
}

/** White dashboard card with flat colored icon tile */
export function ToolCard({ tool }: ToolCardProps) {
  const { t, lang } = useT();
  const openTool = useAppStore((s) => s.openTool);
  const categoryLabel = CATEGORIES.find((c) => c.id === tool.category)?.label ?? tool.category;
  const categoryLabelEn = CATEGORIES.find((c) => c.id === tool.category)?.labelEn ?? categoryLabel;

  return (
    <motion.button
      type="button"
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => openTool(tool.id)}
      aria-label={`${pick(lang, tool.name, tool.nameEn)} — ${pick(lang, tool.desc, tool.descEn)}`}
      style={{ "--glow": tool.glow } as React.CSSProperties}
      className="fm-card fm-card-hover group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl p-5 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/60 hover:shadow-[0_18px_40px_-16px_var(--glow)]"
    >
      {/* icon + hover arrow */}
      <div className="flex items-start">
        <span
          className={`grid h-11 w-11 place-items-center rounded-xl shadow-md transition-transform duration-300 group-hover:scale-110 ${tool.gradient}`}
        >
          <tool.icon className="h-5 w-5 text-white" />
        </span>
        <ArrowUpRight className="ml-auto h-4 w-4 -translate-x-1 translate-y-1 text-emerald-700/40 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" />
      </div>

      <div>
        <h3 className="font-bold text-emerald-950">
          {pick(lang, tool.name, tool.nameEn)}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-emerald-900/60">
          {pick(lang, tool.desc, tool.descEn)}
        </p>
      </div>

      {/* footer badges */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-emerald-600/12 bg-emerald-50/70 px-2 py-0.5 text-[11px] font-medium text-emerald-800/70">
          {pick(lang, categoryLabel, categoryLabelEn)}
        </span>
        {tool.inputMode !== "file" && (
          <span className="rounded-full border border-orange-600/15 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700/80">
            {t("textInputBadge")}
          </span>
        )}
      </div>
    </motion.button>
  );
}
