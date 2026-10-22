"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { filterTools } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";
import { ToolCard } from "@/components/file-hub/tool-card";

export function ToolGrid() {
  const { t, num } = useT();
  const search = useAppStore((s) => s.search);
  const category = useAppStore((s) => s.category);
  const setSearch = useAppStore((s) => s.setSearch);
  const setCategory = useAppStore((s) => s.setCategory);

  const filtered = useMemo(
    () => filterTools(search, category),
    [search, category]
  );

  return (
    <section id="tools" className="mt-10 scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="flex items-center gap-2.5 text-xl font-bold text-emerald-950 sm:text-2xl">
            {t("browseAll")}
          </h2>
          <span className="rounded-full border border-emerald-600/12 bg-white px-3 py-1 text-sm text-emerald-800/70 shadow-sm">
            {num(filtered.length)} {t("toolCount")}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="fm-card rounded-2xl px-6 py-14 text-center">
            <SearchX className="mx-auto h-10 w-10 text-emerald-700/30" />
            <p className="mt-4 font-semibold text-emerald-950/80">
              {t("noMatch")}
            </p>
            <p className="mt-1 text-sm text-emerald-900/55">
              {t("noMatchHint")}
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setCategory("all");
              }}
              className="mt-4 text-emerald-600 hover:bg-emerald-600/10 hover:text-emerald-700"
            >
              {t("seeAll")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((tool, i) => (
              <motion.div
                key={tool.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.025, 0.35) }}
                className="h-full"
              >
                <ToolCard tool={tool} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
