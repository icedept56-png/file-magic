"use client";

import { AnimatePresence, motion } from "framer-motion";
import { History, X } from "lucide-react";

import { getTool } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";

/** Horizontal row of recently used tools (localStorage-backed) */
export function RecentTools() {
  const recent = useAppStore((s) => s.recent);
  const openTool = useAppStore((s) => s.openTool);

  // client-only storage is hydrated after mount; also guard against stale ids
  const tools = recent
    .map((id) => getTool(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  if (tools.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="mx-auto mt-6 w-full max-w-6xl px-4 sm:px-6"
      aria-label="সাম্প্রতিক ব্যবহৃত টুল"
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
          <History className="h-3.5 w-3.5 text-fuchsia-400/80" />
          সাম্প্রতিক
        </span>
        <button
          type="button"
          aria-label="সাম্প্রতিক তালিকা মুছুন"
          onClick={() => {
            try {
              window.localStorage.removeItem("fm-recent-tools");
            } catch {
              /* ignore */
            }
            useAppStore.setState({ recent: [] });
          }}
          className="rounded-md p-1 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="fm-scroll -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
        <AnimatePresence initial={false}>
          {tools.map((t) => (
            <motion.button
              key={t.id}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              onClick={() => openTool(t.id)}
              className="group flex shrink-0 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] py-1.5 pl-2 pr-3.5 text-sm text-zinc-300 transition-colors hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/60"
            >
              <span
                className={`grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br ${t.gradient}`}
              >
                <t.icon className="h-3.5 w-3.5 text-white" />
              </span>
              {t.name}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
