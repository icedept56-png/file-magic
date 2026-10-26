"use client";

import { motion } from "framer-motion";
import { LayoutTemplate, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { TEMPLATES, templateText } from "@/lib/templates";
import { getTool } from "@/lib/tools/registry";
import { pick, useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/** দ্রুত টেমপ্লেট (Day 17) — one-click workflows: NID scan, CV, passport photo… */
export function TemplateGallery() {
  const { t, lang } = useT();
  const openTool = useAppStore((s) => s.openTool);
  const setResumeOpts = useAppStore((s) => s.setResumeOpts);
  const setTemplateHandoff = useAppStore((s) => s.setTemplateHandoff);

  const apply = (tpl: (typeof TEMPLATES)[number]) => {
    const tool = getTool(tpl.toolId);
    if (!tool) return;
    if (tpl.opts) setResumeOpts({ toolId: tpl.toolId, opts: tpl.opts });
    if (tpl.editor) setTemplateHandoff({ toolId: tpl.toolId, ...tpl.editor });
    openTool(tpl.toolId);
    toast.success(templateText(lang, tpl.note), {
      description: pick(lang, tool.name, tool.nameEn),
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08 }}
      className="mx-auto mt-8 w-full max-w-6xl px-4 sm:px-6"
      aria-label={t("tpAria")}
    >
      <h2 className="flex items-center gap-2 text-lg font-bold text-emerald-950 sm:text-xl">
        <LayoutTemplate className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        {t("tpTitle")}
      </h2>
      <p className="mt-1 text-sm text-emerald-900/55">{t("tpSub")}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => apply(tpl)}
            aria-label={`${templateText(lang, tpl.name)} — ${templateText(lang, tpl.desc)}`}
            className="group flex h-full flex-col rounded-2xl border border-emerald-900/[0.07] bg-white p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-600/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <span className={`grid h-9 w-9 place-items-center rounded-xl shadow-sm ${tpl.gradient}`}>
              <tpl.icon className="h-4.5 w-4.5 text-white" />
            </span>
            <span className="mt-2.5 text-sm font-bold leading-snug text-emerald-950">
              {templateText(lang, tpl.name)}
            </span>
            <span className="mt-1 flex-1 text-xs leading-relaxed text-emerald-900/55">
              {templateText(lang, tpl.desc)}
            </span>
            <span className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-600 transition-colors group-hover:text-emerald-700">
              {t("tpStart")}
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </motion.section>
  );
}
