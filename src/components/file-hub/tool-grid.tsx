"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toBn } from "@/lib/tools/helpers";
import { filterTools } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";
import { ToolCard } from "@/components/file-hub/tool-card";

export function ToolGrid() {
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
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold text-zinc-50">সব টুল একসাথে</h2>
          <span className="text-sm text-zinc-500">
            {toBn(filtered.length)} টি টুল
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-6 py-16 text-center backdrop-blur-sm">
            <SearchX className="mx-auto h-10 w-10 text-zinc-600" />
            <p className="mt-4 font-medium text-zinc-300">
              কোনো টুল মেলেনি
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              অন্য কিছু লিখে খুঁজে দেখুন অথবা সব টুল ব্রাউজ করুন।
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setCategory("all");
              }}
              className="mt-4 text-fuchsia-400 hover:bg-white/10 hover:text-fuchsia-300"
            >
              সব টুল দেখুন
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((tool, i) => (
              <motion.div
                key={tool.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.4) }}
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
