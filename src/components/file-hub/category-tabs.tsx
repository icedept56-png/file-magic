"use client";

import { motion } from "framer-motion";

import { CATEGORIES } from "@/lib/tools/registry";
import { useAppStore } from "@/store/app-store";

export function CategoryTabs() {
  const category = useAppStore((s) => s.category);
  const setCategory = useAppStore((s) => s.setCategory);

  return (
    <section className="mt-4">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          className="flex flex-wrap justify-center gap-2"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.03 } },
          }}
          role="group"
          aria-label="ক্যাটাগরি বাছাই"
        >
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <motion.button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={active}
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
                }}
                className={
                  active
                    ? `rounded-full bg-gradient-to-r ${c.gradient} px-4 py-2 text-sm font-medium text-white shadow-lg transition`
                    : "rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/60"
                }
              >
                {c.label}
              </motion.button>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
