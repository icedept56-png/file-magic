"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clock3, FileText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clearActivity, getActivity, relTime, type ActivityRecord } from "@/lib/recents";
import { formatBytes } from "@/lib/tools/helpers";
import { getTool } from "@/lib/tools/registry";
import { pick, useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/**
 * সাম্প্রতিক কাজ (Day 14) — recent successful runs, metadata only.
 * Clicking a row re-opens the tool with the previous options pre-filled
 * ("চালিয়ে যাওয়া"); files are never stored, so the user re-stages them.
 */
export function RecentActivity() {
  const { t, num, lang } = useT();
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [mounted, setMounted] = useState(false);
  const openTool = useAppStore((s) => s.openTool);
  const setResumeOpts = useAppStore((s) => s.setResumeOpts);

  const reload = useCallback(() => {
    void getActivity(6).then((rows) => {
      setItems(rows);
      setMounted(true);
    });
  }, []);

  // load after mount + whenever the user comes back home from a tool view
  useEffect(() => {
    reload();
    const unsub = useAppStore.subscribe((s, prev) => {
      if (s.view !== prev.view && s.view === "home") reload();
    });
    return unsub;
  }, [reload]);

  const resume = (r: ActivityRecord) => {
    setResumeOpts({ toolId: r.toolId, opts: r.opts ?? {} });
    openTool(r.toolId);
  };

  if (!mounted || items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06 }}
      className="mx-auto mt-6 w-full max-w-6xl px-4 sm:px-6"
      aria-label={t("raAria")}
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-800/60">
          <Clock3 className="h-3.5 w-3.5 text-emerald-600" />
          {t("raTitle")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void clearActivity().then(reload);
          }}
          aria-label={t("raClearAria")}
          className="ml-auto h-8 gap-1 rounded-lg px-2 text-xs text-emerald-800/50 hover:bg-emerald-600/10 hover:text-emerald-700"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("raClear")}
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false}>
          {items.map((r) => {
            const tool = getTool(r.toolId);
            if (!tool) return null;
            const summary =
              r.count > 0
                ? `${num(r.count)} ${t("raFiles")} · ${formatBytes(r.bytes)} · ${num(r.outputs)} ${t("raOutputs")}`
                : `${t("raTextInput")} · ${num(r.outputs)} ${t("raOutputs")}`;
            return (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  onClick={() => resume(r)}
                  aria-label={`${pick(lang, tool.name, tool.nameEn)} — ${t("raResume")}`}
                  className="group flex min-h-11 w-full items-center gap-3 rounded-2xl border border-emerald-900/[0.07] bg-white p-3 text-left shadow-sm transition-all hover:border-emerald-600/25 hover:bg-emerald-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-sm ${tool.gradient}`}>
                    <tool.icon className="h-4 w-4 text-white" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-emerald-950">
                        {pick(lang, tool.name, tool.nameEn)}
                      </span>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700/80">
                        {relTime(r.at, lang === "bn", num)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-emerald-900/55">
                      {r.count === 0 && <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      <span className="truncate">
                        {r.count > 0 ? r.names.join(", ") : summary}
                      </span>
                    </span>
                    {r.count > 0 && (
                      <span className="mt-0.5 block truncate text-[11px] text-emerald-900/40">{summary}</span>
                    )}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-emerald-600/50 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-600" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
