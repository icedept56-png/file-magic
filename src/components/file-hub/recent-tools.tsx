"use client";

import { AnimatePresence, motion } from "framer-motion";
import { History, X } from "lucide-react";

import { getTool } from "@/lib/tools/registry";
import { pick, useT } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

/** Horizontal row of recently used tools (localStorage-backed) */
export function RecentTools() {
  const { t, lang } = useT();
  const recent = useAppStore((s) => s.recent);
  const openTool = useAppStore((s) => s.openTool);

  // client-only storage is hydrated after mount; also guard against stale ids
  const tools = recent
    .map((id) => getTool(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  if (tools.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.04 }}
      className="mx-auto mt-6 w-full max-w-6xl px-4 sm:px-6"
      aria-label={t("recentAria")}
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-800/60">
          <History className="h-3.5 w-3.5 text-emerald-600" />
          {t("recent")}
        </span>
        <button
          type="button"
          aria-label={t("clearRecent")}
          onClick={() => {
            try {
              window.localStorage.removeItem("fm-recent-tools");
            } catch {
              /* ignore */
            }
            useAppStore.setState({ recent: [] });
          }}
          className="rounded-md p-1 text-emerald-800/40 transition hover:bg-emerald-600/10 hover:text-emerald-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="fm-scroll -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
        <AnimatePresence initial={false}>
          {tools.map((tool) => (
            <motion.button
              key={tool.id}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              onClick={() => openTool(tool.id)}
              className="group flex shrink-0 items-center gap-2 rounded-full border border-emerald-900/[0.07] bg-white py-1.5 pl-2 pr-3.5 text-sm text-emerald-950/80 shadow-sm transition-colors hover:border-emerald-600/25 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <span
                className={`grid h-6 w-6 place-items-center rounded-full shadow-sm ${tool.gradient}`}
              >
                <tool.icon className="h-3.5 w-3.5 text-white" />
              </span>
              {pick(lang, tool.name, tool.nameEn)}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
